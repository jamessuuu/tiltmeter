/**
 * `run` orchestration (SPEC §14 M1: "`run` writes one reading per §3.3
 * with completeness accounting where the denominator is ALWAYS items×k
 * and noResult is NEVER scored as a fail").
 *
 * This is core, not node: it takes an injected `ModelClient` (the real
 * Anthropic client at M4, `FakeModelClient` everywhere else) and an
 * injected clock, and returns a `Reading` value — it does not touch a
 * filesystem. Persisting that value to `observatory/readings/**` is a
 * `src/node` concern (SPEC §6 module map).
 *
 * M4 addition: the trial-scoring/completeness/metrics/bodyHash logic is
 * factored out as `buildReadingFromTrials` so `core/batch.ts`'s Batch-API
 * orchestrator (which collects `(itemId, attempt) -> TrialResult` from a
 * fetched batch instead of calling `client.runTrial` in a loop) reuses the
 * EXACT same reading-assembly rules as the sync path below — one
 * implementation of "denominator is items×k" and "noResult never scored as
 * a fail", not two that could drift.
 */
import { activeItems, type Item, type Suite } from "./suite.js";
import { renderPresentation, type Presentation } from "./presentation.js";
import type { ModelClient, TrialResult } from "./model-client.js";
import { score } from "./scorers.js";
import type {
  Completeness,
  ItemReading,
  Reading,
  ReadingAxes,
  ReadingCost,
  ReadingStatus,
  Trial,
} from "./reading.js";
import { jcsCanonical } from "./canonical.js";
import { sha256Hex } from "./sha256.js";

export interface RunContext {
  runGroupId: string;
  cellId: string;
  suiteSpecHash: string;
  presentationHash: string;
  samplingPolicyHash: string;
  runnerBehaviorVersion: number;
  modelIdRequested: string;
  harnessCommit: string;
  runnerVersion: string;
  /** Injected clock (SPEC §6: core reads no ambient state) — returns an ISO-8601 timestamp. */
  now: () => string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * SPEC §5: `overall` over all active items, `triggerRate` over positives,
 * `falsePositiveRate` over negatives (a negative's pass = correctly silent,
 * so its false-positive contribution is `1 - passFraction`). Metric names
 * the suite declares that this runner does not recognize are silently
 * omitted from the reading rather than guessed — SPEC §13's lint (M5) is
 * where an unrecognized declared metric should be caught.
 */
export function computeMetrics(
  suite: Suite,
  items: Item[],
  itemReadings: ItemReading[],
): Record<string, number> {
  const passFractionById = new Map(itemReadings.map((ir) => [ir.id, ir.k > 0 ? ir.passes / ir.k : 0]));
  const positives = items.filter((i) => i.polarity === "positive");
  const negatives = items.filter((i) => i.polarity === "negative");
  const fractionOf = (item: Item) => passFractionById.get(item.id) ?? 0;

  const out: Record<string, number> = {};
  for (const metric of suite.metrics) {
    switch (metric) {
      case "overall":
        out[metric] = mean(items.map(fractionOf));
        break;
      case "triggerRate":
        out[metric] = mean(positives.map(fractionOf));
        break;
      case "falsePositiveRate":
        out[metric] = mean(negatives.map((i) => 1 - fractionOf(i)));
        break;
      default:
        break;
    }
  }
  return out;
}

/** One (item, k-repeat) trial's outcome, wherever it came from — a live sync call, or a fetched-and-mapped-back batch result. */
export interface TrialOutcomeRecord {
  itemId: string;
  attempt: number;
  result: TrialResult;
}

export type ReadingWithoutHash = Omit<Reading, "bodyHash">;

/**
 * Assemble a `Reading` from a suite's active items and a full set of
 * `(itemId, attempt)` trial outcomes — the shared core of both run modes
 * (SPEC §6, this file's own header comment). `trialsByItem` MUST contain
 * exactly `suite.sampling.k` (or `kOverride`, for a release run's k=5 —
 * SPEC §8) entries per active item; a missing attempt is a caller bug, not
 * a `noResult` (a `noResult` is a populated entry whose `result.outcome` is
 * `"noResult"`).
 */
export function buildReadingFromTrials(
  suite: Suite,
  items: Item[],
  trialsByItem: ReadonlyMap<string, readonly TrialResult[]>,
  ctx: RunContext,
  startedAt: string,
  finishedAt: string,
  k: number,
): Reading {
  const itemReadings: ItemReading[] = [];
  let resolvedModelId: string | undefined;
  let okCount = 0;
  let noResultCount = 0;
  let anyModelUnavailable = false;

  for (const item of items) {
    const trialResults = trialsByItem.get(item.id) ?? [];
    const trials: Trial[] = [];
    let passes = 0;
    for (let attempt = 1; attempt <= k; attempt++) {
      const result = trialResults[attempt - 1];
      if (result === undefined || result.outcome === "noResult") {
        const reason = result?.reason ?? "missing trial result";
        trials.push({ attempt, outcome: "noResult", noResultReason: reason });
        noResultCount++;
        if (result?.modelUnavailable === true) anyModelUnavailable = true;
        continue;
      }
      const response = result.response;
      resolvedModelId ??= response.modelIdResolved;
      const scored = score(response, item.expect);
      if (scored.outcome === "pass") passes++;
      const trial: Trial = {
        attempt,
        outcome: scored.outcome,
        stopReason: response.stopReason,
        usage: response.usage,
      };
      if (scored.firstTool !== undefined) trial.firstTool = scored.firstTool;
      if (scored.firstArgs !== undefined) trial.args = scored.firstArgs;
      trials.push(trial);
      okCount++;
    }
    itemReadings.push({ id: item.id, polarity: item.polarity, k, passes, trials });
  }

  const expectedTrials = items.length * k;
  const completeness: Completeness = {
    expectedTrials,
    ok: okCount,
    error: 0,
    noResult: noResultCount,
  };
  const metrics = computeMetrics(suite, items, itemReadings);
  const modelIdResolved = resolvedModelId ?? ctx.modelIdRequested;
  const axes: ReadingAxes = {
    suiteSpecHash: ctx.suiteSpecHash,
    modelIdRequested: ctx.modelIdRequested,
    modelIdResolved,
    aliasUsed: modelIdResolved !== ctx.modelIdRequested,
    runnerBehaviorVersion: ctx.runnerBehaviorVersion,
    presentationHash: ctx.presentationHash,
    samplingPolicyHash: ctx.samplingPolicyHash,
  };

  // SPEC §9: a model-id-unavailable signal on ANY trial means nothing about
  // this cell is trustworthy — "unavailable", not "partial" (which implies
  // a normally-working cell with some transient misses).
  const status: ReadingStatus = anyModelUnavailable ? "unavailable" : noResultCount > 0 ? "partial" : "complete";

  const withoutHash: ReadingWithoutHash = {
    formatVersion: 1 as const,
    runGroupId: ctx.runGroupId,
    suiteId: suite.id,
    cellId: ctx.cellId,
    axes,
    harnessCommit: ctx.harnessCommit,
    runnerVersion: ctx.runnerVersion,
    startedAt,
    finishedAt,
    status,
    completeness,
    metrics,
    items: itemReadings,
  };
  return finalizeReading(withoutHash);
}

/** Recompute `bodyHash` over every field except `bodyHash` itself (SPEC §3.3) — the one place that hashing happens, called both by the initial build and by any later field-attachment (`attachReadingCost`, `markReadingAborted`) so the hash always reflects the reading's final, complete shape. */
export function finalizeReading(withoutHash: ReadingWithoutHash): Reading {
  const bodyHash = `sha256:${sha256Hex(jcsCanonical(withoutHash))}`;
  return { ...withoutHash, bodyHash };
}

/** Attach a `cost` block (SPEC §3.3) to an already-built reading and re-finalize — used once a cell's real (batch- or sync-mode) usage/pricing is known, which `buildReadingFromTrials` itself has no pricing context to compute. */
export function attachReadingCost(reading: Reading, cost: ReadingCost): Reading {
  const { bodyHash: _oldHash, ...rest } = reading;
  return finalizeReading({ ...rest, cost });
}

export async function runSuite(
  suite: Suite,
  presentation: Presentation,
  client: ModelClient,
  ctx: RunContext,
): Promise<Reading> {
  const plans = renderPresentation(suite, presentation);
  const items = activeItems(suite);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const k = suite.sampling.k;

  const startedAt = ctx.now();
  const trialsByItem = new Map<string, TrialResult[]>();

  for (const plan of plans) {
    const item = itemById.get(plan.itemId);
    if (item === undefined) continue; // renderPresentation only emits active-item plans; defensive only.
    const trials: TrialResult[] = [];
    for (let attempt = 1; attempt <= k; attempt++) {
      trials.push(await client.runTrial(plan, attempt, ctx.modelIdRequested));
    }
    trialsByItem.set(item.id, trials);
  }

  const finishedAt = ctx.now();
  return buildReadingFromTrials(suite, items, trialsByItem, ctx, startedAt, finishedAt, k);
}

/**
 * SPEC §8 cap-abort path: a cell that was never even submitted because a
 * cap tripped after a PRIOR cell in the same run completed. Every expected
 * trial is `noResult` (never a silent skip — SPEC §8: "never a silent
 * skip"), `status: "aborted"`, `abortedBy: "cap"`. `k` is passed
 * separately from `suite.sampling.k` because a release run can override it
 * (SPEC §8: k=5 on release-triggered runs).
 */
export function buildNeverAttemptedAbortedReading(suite: Suite, ctx: RunContext, k: number): Reading {
  const items = activeItems(suite);
  const timestamp = ctx.now();
  const noResultTrials = (): Trial[] =>
    Array.from({ length: k }, (_, i) => ({
      attempt: i + 1,
      outcome: "noResult" as const,
      noResultReason: "aborted: spend cap reached before this cell could be submitted",
    }));
  const itemReadings: ItemReading[] = items.map((item) => ({
    id: item.id,
    polarity: item.polarity,
    k,
    passes: 0,
    trials: noResultTrials(),
  }));
  const expectedTrials = items.length * k;
  const completeness: Completeness = { expectedTrials, ok: 0, error: 0, noResult: expectedTrials };
  const axes: ReadingAxes = {
    suiteSpecHash: ctx.suiteSpecHash,
    modelIdRequested: ctx.modelIdRequested,
    modelIdResolved: ctx.modelIdRequested,
    aliasUsed: false,
    runnerBehaviorVersion: ctx.runnerBehaviorVersion,
    presentationHash: ctx.presentationHash,
    samplingPolicyHash: ctx.samplingPolicyHash,
  };
  const withoutHash: ReadingWithoutHash = {
    formatVersion: 1 as const,
    runGroupId: ctx.runGroupId,
    suiteId: suite.id,
    cellId: ctx.cellId,
    axes,
    harnessCommit: ctx.harnessCommit,
    runnerVersion: ctx.runnerVersion,
    startedAt: timestamp,
    finishedAt: timestamp,
    status: "aborted",
    abortedBy: "cap",
    completeness,
    metrics: computeMetrics(suite, items, itemReadings),
    items: itemReadings,
  };
  return finalizeReading(withoutHash);
}
