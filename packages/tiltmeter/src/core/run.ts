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
 */
import { activeItems, type Item, type Suite } from "./suite.js";
import { renderPresentation, type Presentation } from "./presentation.js";
import type { ModelClient } from "./model-client.js";
import { score } from "./scorers.js";
import type { Completeness, ItemReading, Reading, ReadingAxes, Trial } from "./reading.js";
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

export async function runSuite(
  suite: Suite,
  presentation: Presentation,
  client: ModelClient,
  ctx: RunContext,
): Promise<Reading> {
  const plans = renderPresentation(suite, presentation);
  const items = activeItems(suite);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const startedAt = ctx.now();
  const itemReadings: ItemReading[] = [];
  let resolvedModelId: string | undefined;
  let okCount = 0;
  let noResultCount = 0;

  for (const plan of plans) {
    const item = itemById.get(plan.itemId);
    if (item === undefined) continue; // renderPresentation only emits active-item plans; defensive only.
    const trials: Trial[] = [];
    let passes = 0;
    for (let attempt = 1; attempt <= suite.sampling.k; attempt++) {
      const result = await client.runTrial(plan, attempt);
      if (result.outcome === "noResult") {
        trials.push({ attempt, outcome: "noResult", noResultReason: result.reason });
        noResultCount++;
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
    itemReadings.push({ id: item.id, k: suite.sampling.k, passes, trials });
  }

  const finishedAt = ctx.now();
  const expectedTrials = items.length * suite.sampling.k;
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

  const withoutHash = {
    formatVersion: 1 as const,
    runGroupId: ctx.runGroupId,
    cellId: ctx.cellId,
    axes,
    harnessCommit: ctx.harnessCommit,
    runnerVersion: ctx.runnerVersion,
    startedAt,
    finishedAt,
    status: (noResultCount > 0 ? "partial" : "complete") as Reading["status"],
    completeness,
    metrics,
    items: itemReadings,
  };
  const bodyHash = `sha256:${sha256Hex(jcsCanonical(withoutHash))}`;
  return { ...withoutHash, bodyHash };
}
