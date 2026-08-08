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
  /**
   * Concatenated text content blocks, if any (M5, SPEC §3.2's
   * `literal-prefix` scorer: "regex scorers exist only for control tokens
   * an instruction explicitly demands, never for prose semantics" — this
   * field exists ONLY so `literal-prefix` can check a literal,
   * explicitly-demanded prefix; no scorer reads it for meaning).
   */
  text?: string;
  usage: TokenUsage;
  /** The API response's resolved model id (SPEC §4 alias substitution: `axes.modelIdResolved`). */
  modelIdResolved: string;
}

/** A trial that could not be scored at all (SPEC §9): transient failure or truncation. Never scored as a fail. */
export interface NoResultTrial {
  outcome: "noResult";
  reason: string;
  /**
   * SPEC §9 "Model id 404 / retired": set when the provider reports the
   * requested model id itself does not exist / has been retired — distinct
   * from a transient failure. The reading-builder (`core/run.ts`) treats
   * ANY trial carrying this flag as evidence the whole cell is
   * unattemptable and marks the reading `status: "unavailable"` rather than
   * `"partial"`, short-circuiting the rest of that cell (SPEC: "cell
   * unavailable, run continues [to the next cell]").
   */
  modelUnavailable?: boolean;
}

export type TrialResult =
  | { outcome: "ok"; response: ModelTrialResponse }
  | NoResultTrial;

/** SPEC §7 `plan`: the free `count_tokens` endpoint result for one rendered request — exact, per model (so the 4.7+ tokenizer inflation is measured, not guessed). */
export interface TokenCountResult {
  inputTokens: number;
}

/** One request in a Batch API submission (SPEC §9): `customId` is the caller's deterministic `sha256(runGroup,suite,item,trial)` (`core/batch.ts`), computed and recorded by the caller before this is ever sent. */
export interface BatchRequestItem {
  customId: string;
  plan: RequestPlan;
}

export interface BatchSubmission {
  batchId: string;
}

export interface BatchPollResult {
  ended: boolean;
}

/** One request's outcome inside a completed (or partially-completed) batch, keyed by the same `customId` it was submitted with. `result` is `noResult` (never a thrown error) for an errored/expired/canceled request — batch failures are data, not exceptions, so the orchestrator can apply SPEC §9's one-retry-of-the-failed-subset rule uniformly. */
export interface BatchResultItem {
  customId: string;
  result: TrialResult;
}

export interface ModelClient {
  /**
   * Run one independent trial (SPEC §3.2: k repeats at t=1.0, no seed
   * parameter exists on the API — that is why `attempt` is passed through
   * for FakeModelClient's per-(item,attempt) scripting rather than being
   * used as a seed). `modelIdRequested` is a per-CALL parameter, not baked
   * into the client instance — one `ModelClient` serves every cell of a run
   * group (SPEC §4: a run group fills every cell of `panel × suites`), and
   * different cells request different models. `RequestPlan` itself (SPEC
   * §7) stays model-independent — a presentation renders once per suite.
   */
  runTrial(plan: RequestPlan, attempt: number, modelIdRequested: string): Promise<TrialResult>;
  /** SPEC §7 `plan`: exact input-token count for a rendered request, per model (so the 4.7+ tokenizer inflation is measured, not guessed). Free — never counted against any spend cap. */
  countTokens(plan: RequestPlan, modelIdRequested: string): Promise<TokenCountResult>;
  /** SPEC §9: submit many requests — all for the SAME cell, hence the same model — as one batch job. */
  submitBatch(requests: BatchRequestItem[], modelIdRequested: string): Promise<BatchSubmission>;
  pollBatch(batchId: string): Promise<BatchPollResult>;
  /** Only meaningful once `pollBatch` reports `ended: true`. */
  fetchBatchResults(batchId: string): Promise<BatchResultItem[]>;
}
