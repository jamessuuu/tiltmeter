/**
 * The `ModelClient` contract (SPEC §6): the ONLY seam between the pure
 * runner and a model. `src/client/**` (real Anthropic client, M4) and
 * `src/testing/FakeModelClient` (M1) both implement this interface; core
 * never imports either — it is injected. Defining the shape here (types
 * only, zero runtime footprint) keeps core pure while still typing the
 * injection point, matching how `core/presentation` produces `RequestPlan[]`
 * and `core/reading` consumes `ModelTrialResponse`.
 */

/** A tool definition, Anthropic Messages API shape (verbatim for `tool-schema` artifacts). */
export interface ToolDef {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type ToolChoice = { type: "auto" } | { type: "any" } | { type: "tool"; name: string };

export interface UserMessage {
  role: "user";
  content: string;
}

/** One item's fully-rendered request — everything `ModelClient.runTrial` needs. */
export interface RequestPlan {
  itemId: string;
  system: string;
  tools: ToolDef[];
  toolChoice: ToolChoice;
  messages: UserMessage[];
  maxTokens: number;
  temperature: number;
}

export interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: Record<string, unknown>;
}

export type StopReason = "tool_use" | "end_turn" | "max_tokens" | "stop_sequence";

export interface TokenUsage {
  in: number;
  out: number;
}

/** SPEC §3.2: "Scoring reads the FIRST tool_use block (full list recorded; tool-order uses the list)." */
export interface ModelTrialResponse {
  stopReason: StopReason;
  toolUseBlocks: ToolUseBlock[];
  usage: TokenUsage;
  /** The API response's resolved model id (SPEC §4 alias substitution: `axes.modelIdResolved`). */
  modelIdResolved: string;
}

/** A trial that could not be scored at all (SPEC §9): transient failure or truncation. Never scored as a fail. */
export interface NoResultTrial {
  outcome: "noResult";
  reason: string;
}

export type TrialResult =
  | { outcome: "ok"; response: ModelTrialResponse }
  | NoResultTrial;

export interface ModelClient {
  /**
   * Run one independent trial (SPEC §3.2: k repeats at t=1.0, no seed
   * parameter exists on the API — that is why `attempt` is passed through
   * for FakeModelClient's per-(item,attempt) scripting rather than being
   * used as a seed).
   */
  runTrial(plan: RequestPlan, attempt: number): Promise<TrialResult>;
}
