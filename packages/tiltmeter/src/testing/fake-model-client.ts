/**
 * `FakeModelClient` (SPEC §14 M1) — injected in place of the real
 * Anthropic client so the entire eval suite runs offline at $0 (SPEC §6).
 * Scripted by item id + attempt: a script maps `(itemId, attempt)` to a
 * `TrialResult`, matching how `core/run.ts` calls `client.runTrial(plan,
 * attempt)` once per (item, k-repeat).
 */
import type {
  ModelClient,
  ModelTrialResponse,
  RequestPlan,
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

export function noResultTrial(reason: string): TrialResult {
  return { outcome: "noResult", reason };
}

export class FakeModelClient implements ModelClient {
  private readonly script: FakeScript;
  private readonly fallback: TrialResult;

  constructor(options: FakeModelClientOptions) {
    this.script = options.script;
    this.fallback = options.fallback ?? noToolTrial();
  }

  runTrial(plan: RequestPlan, attempt: number): Promise<TrialResult> {
    const scripted = this.script[plan.itemId]?.[attempt];
    return Promise.resolve(scripted ?? this.fallback);
  }
}
