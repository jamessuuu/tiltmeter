/**
 * `FakeModelClient` (SPEC §14 M1/M4) — injected in place of the real
 * Anthropic client so the entire eval suite runs offline at $0 (SPEC §6).
 * Scripted by item id + attempt: a script maps `(itemId, attempt)` to a
 * `TrialResult`, matching how `core/run.ts` calls `client.runTrial(plan,
 * attempt)` once per (item, k-repeat).
 *
 * M4 extends it to implement the FULL `ModelClient` interface — the same
 * one the real Anthropic client (`src/client/anthropic.ts`) implements —
 * so `core/plan.ts` (`countTokens`) and `core/batch.ts`'s orchestrator
 * (`submitBatch`/`pollBatch`/`fetchBatchResults`) are testable with zero
 * network. `countTokens` is scripted separately (`tokenScript`, defaulting
 * to a deterministic byte-length heuristic so tests don't have to script
 * it for every plan); the batch methods are a pure in-memory simulation
 * over the SAME `script` that already answers `runTrial` — a batch's
 * per-request results are just `runTrial` outcomes collected by
 * `customId` instead of returned one at a time. `pollBatch` reports
 * `ended: true` immediately (no artificial delay — a real poll loop is a
 * node/client concern, not something this fake needs to simulate) unless
 * `batchEndsAfterPolls` says otherwise, so a test can exercise a
 * multi-poll `run --resume` sequence deterministically.
 */
import type {
  BatchPollResult,
  BatchRequestItem,
  BatchResultItem,
  BatchSubmission,
  ModelClient,
  ModelTrialResponse,
  RequestPlan,
  TokenCountResult,
  TokenUsage,
  ToolUseBlock,
  TrialResult,
} from "../core/model-client.js";
export type { TrialResult } from "../core/model-client.js";

/** itemId -> attempt (1-based) -> the trial result for that attempt. */
export type FakeScript = Record<string, Record<number, TrialResult> | undefined>;

export interface FakeModelClientOptions {
  script: FakeScript;
  /** Returned when a (itemId, attempt) pair has no scripted entry. Defaults to "no tool called". */
  fallback?: TrialResult;
  /** Overrides `countTokens`' default heuristic (chars/4 of the rendered request) for specific item ids — tests that need an EXACT, known token count for a cap/pricing assertion set this instead of relying on the heuristic. */
  tokenScript?: Record<string, number>;
  /** How many `pollBatch` calls a submitted batch takes to report `ended: true`. Defaults to 1 (ends on the first poll) — set higher to test a resume sequence that polls more than once. */
  batchEndsAfterPolls?: number;
}

const DEFAULT_USAGE: TokenUsage = { in: 100, out: 20 };
const DEFAULT_MODEL_ID = "fake-model-1";

export function toolUseTrial(
  name: string,
  input: Record<string, unknown> = {},
  overrides: Partial<Omit<ModelTrialResponse, "toolUseBlocks">> = {},
): TrialResult {
  const toolUseBlocks: ToolUseBlock[] = [{ type: "tool_use", name, input }];
  return {
    outcome: "ok",
    response: {
      stopReason: "tool_use",
      toolUseBlocks,
      usage: DEFAULT_USAGE,
      modelIdResolved: DEFAULT_MODEL_ID,
      ...overrides,
    },
  };
}

/** SPEC §3.2 `instruction-adherence`'s `tool-order` scorer: multiple tool_use blocks in one response, in the given order. */
export function multiToolTrial(
  calls: readonly { name: string; input?: Record<string, unknown> }[],
  overrides: Partial<Omit<ModelTrialResponse, "toolUseBlocks">> = {},
): TrialResult {
  const toolUseBlocks: ToolUseBlock[] = calls.map((c) => ({ type: "tool_use", name: c.name, input: c.input ?? {} }));
  return {
    outcome: "ok",
    response: {
      stopReason: "tool_use",
      toolUseBlocks,
      usage: DEFAULT_USAGE,
      modelIdResolved: DEFAULT_MODEL_ID,
      ...overrides,
    },
  };
}

/** SPEC §3.2 `instruction-adherence`'s `literal-prefix` scorer: a text-only response (no tool call), carrying `text`. */
export function textTrial(text: string, overrides: Partial<Omit<ModelTrialResponse, "toolUseBlocks" | "text">> = {}): TrialResult {
  return {
    outcome: "ok",
    response: {
      stopReason: "end_turn",
      toolUseBlocks: [],
      text,
      usage: DEFAULT_USAGE,
      modelIdResolved: DEFAULT_MODEL_ID,
      ...overrides,
    },
  };
}

export function noToolTrial(overrides: Partial<ModelTrialResponse> = {}): TrialResult {
  return {
    outcome: "ok",
    response: {
      stopReason: "end_turn",
      toolUseBlocks: [],
      usage: DEFAULT_USAGE,
      modelIdResolved: DEFAULT_MODEL_ID,
      ...overrides,
    },
  };
}

export function noResultTrial(reason: string, options: { modelUnavailable?: boolean } = {}): TrialResult {
  const { modelUnavailable } = options;
  return modelUnavailable === undefined
    ? { outcome: "noResult", reason }
    : { outcome: "noResult", reason, modelUnavailable };
}

let batchCounter = 0;

export class FakeModelClient implements ModelClient {
  private readonly script: FakeScript;
  private readonly fallback: TrialResult;
  private readonly tokenScript: Record<string, number>;
  private readonly batchEndsAfterPolls: number;
  private readonly batches = new Map<string, { requests: BatchRequestItem[]; pollCount: number }>();
  /** customId -> scripted TrialResult, keyed independently of item/attempt — batch tests script by the exact deterministic customId (`core/batch.ts`'s `batchCustomId`) since that is what a real batch result is keyed by. */
  private readonly customIdScript = new Map<string, TrialResult>();

  constructor(options: FakeModelClientOptions) {
    this.script = options.script;
    this.fallback = options.fallback ?? noToolTrial();
    this.tokenScript = options.tokenScript ?? {};
    this.batchEndsAfterPolls = options.batchEndsAfterPolls ?? 1;
  }

  runTrial(plan: RequestPlan, attempt: number, _modelIdRequested: string): Promise<TrialResult> {
    const scripted = this.script[plan.itemId]?.[attempt];
    return Promise.resolve(scripted ?? this.fallback);
  }

  countTokens(plan: RequestPlan, _modelIdRequested: string): Promise<TokenCountResult> {
    const scripted = this.tokenScript[plan.itemId];
    if (scripted !== undefined) return Promise.resolve({ inputTokens: scripted });
    // Deterministic default so unscripted plans still produce a stable, non-zero count.
    const requestText = plan.system + JSON.stringify(plan.tools) + JSON.stringify(plan.toolChoice) +
      plan.messages.map((m) => m.content).join("\n");
    return Promise.resolve({ inputTokens: Math.ceil(requestText.length / 4) });
  }

  submitBatch(requests: BatchRequestItem[], _modelIdRequested: string): Promise<BatchSubmission> {
    batchCounter += 1;
    const batchId = `fake-batch-${String(batchCounter)}`;
    this.batches.set(batchId, { requests, pollCount: 0 });
    return Promise.resolve({ batchId });
  }

  pollBatch(batchId: string): Promise<BatchPollResult> {
    const batch = this.batches.get(batchId);
    if (batch === undefined) throw new Error(`FakeModelClient.pollBatch: unknown batchId "${batchId}"`);
    batch.pollCount += 1;
    return Promise.resolve({ ended: batch.pollCount >= this.batchEndsAfterPolls });
  }

  fetchBatchResults(batchId: string): Promise<BatchResultItem[]> {
    const batch = this.batches.get(batchId);
    if (batch === undefined) throw new Error(`FakeModelClient.fetchBatchResults: unknown batchId "${batchId}"`);
    const out: BatchResultItem[] = [];
    for (const { customId, plan } of batch.requests) {
      // A batch request carries no `attempt` — the caller (`core/batch.ts`)
      // is the one place that knows how to map a customId back to
      // (itemId, attempt). Absent an explicit `scriptByCustomId` entry,
      // this fake answers with the item's attempt-1 script (correct for
      // every k=1 test, and for k>1 tests where every attempt of an item
      // is scripted identically, which `scriptForBehavior` always does).
      const perAttempt = this.script[plan.itemId];
      const byCustomId = this.customIdScript.get(customId);
      const result = byCustomId ?? perAttempt?.[1] ?? this.fallback;
      out.push({ customId, result });
    }
    return Promise.resolve(out);
  }

  /** Test helper: script an exact result for a given batch `customId` (SPEC §9's batch path is keyed by customId, not (itemId, attempt) — this is how a test simulates a specific request expiring/erroring inside an otherwise-successful batch). */
  scriptByCustomId(customId: string, result: TrialResult): void {
    this.customIdScript.set(customId, result);
  }
}
