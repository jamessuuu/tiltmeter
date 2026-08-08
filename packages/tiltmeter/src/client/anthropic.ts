/**
 * The real Anthropic client (SPEC §7/§14 M4) — Messages API (sync
 * `runTrial`), the free `count_tokens` endpoint, the Message Batches API,
 * and full-jitter backoff (`./backoff.ts`), all behind the SAME
 * `ModelClient` interface `FakeModelClient` implements (`core/model-client.ts`).
 * This is `src/client`: the ONLY network boundary in the codebase (SPEC
 * §6) — `core` never imports this file, it only knows the interface.
 *
 * BYOK (SPEC §7): the API key is handed to the constructor by the CLI
 * layer, which reads it from `process.env.ANTHROPIC_API_KEY` ONLY — never
 * a flag, never written to disk. This file itself never reads `process.env`
 * (SPEC §6: only `src/cli` touches real env).
 *
 * Verification note: every request/response shape below is written from
 * the documented Messages / Message Batches / count_tokens API contracts.
 * SPEC's own build order is explicit that M4 ships with "NO live smoke
 * run" — nothing here has been exercised against a real `api.anthropic.com`
 * call; every test in `anthropic.test.ts` injects a fake `fetch` so this
 * stays true offline. The `workflow_dispatch`-gated live smoke path (SPEC
 * §12) is the first place this code is meant to touch the real network,
 * and that step is intentionally left unexecuted here.
 */
import type {
  BatchPollResult,
  BatchRequestItem,
  BatchResultItem,
  ModelClient,
  ModelTrialResponse,
  RequestPlan,
  StopReason,
  TokenCountResult,
  ToolUseBlock,
  TrialResult,
} from "../core/model-client.js";
import { TiltmeterError } from "../core/errors.js";
import { withFullJitterRetry, type BackoffDeps } from "./backoff.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected so tests never touch a real socket (SPEC: "NO network in tests"). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  backoffDeps?: BackoffDeps;
}

function headers(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
}

/** The Messages-API-shaped request body every one of `runTrial`/`countTokens`/a batch request's `params` shares. */
function requestBody(plan: RequestPlan, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: plan.maxTokens,
    temperature: plan.temperature,
    system: plan.system,
    tools: plan.tools,
    tool_choice: plan.toolChoice,
    messages: plan.messages,
  };
}

const STOP_REASONS: readonly StopReason[] = ["tool_use", "end_turn", "max_tokens", "stop_sequence"];
function coerceStopReason(value: unknown): StopReason {
  return typeof value === "string" && (STOP_REASONS as readonly string[]).includes(value)
    ? (value as StopReason)
    : "end_turn";
}

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicMessageResponse {
  model?: string;
  stop_reason?: string;
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

function toModelTrialResponse(body: AnthropicMessageResponse, requestedModel: string): ModelTrialResponse {
  const toolUseBlocks: ToolUseBlock[] = (body.content ?? [])
    .filter((b): b is AnthropicContentBlock & { type: "tool_use"; name: string } => b.type === "tool_use" && typeof b.name === "string")
    .map((b) => ({ type: "tool_use" as const, name: b.name, input: b.input ?? {} }));
  return {
    stopReason: coerceStopReason(body.stop_reason),
    toolUseBlocks,
    usage: { in: body.usage?.input_tokens ?? 0, out: body.usage?.output_tokens ?? 0 },
    modelIdResolved: body.model ?? requestedModel,
  };
}

/** SPEC §9 taxonomy: which HTTP statuses are transient (retry), which mean the model id itself is gone (unavailable, never retry), and which are a hard client-side error (never retry, never echo the body — SECURITY.md). */
function classifyStatus(status: number): { retryable: boolean; modelUnavailable: boolean } {
  if (status === 404) return { retryable: false, modelUnavailable: true };
  if (status === 429 || status === 529 || (status >= 500 && status < 600)) {
    return { retryable: true, modelUnavailable: false };
  }
  return { retryable: false, modelUnavailable: false };
}

/**
 * Build a `RetryableAttempt` failure branch from a non-ok `Response` —
 * shared by every endpoint below. Never includes the raw response body
 * (SECURITY.md: "the raw provider error body is never surfaced"), only the
 * HTTP status. `exactOptionalPropertyTypes` means `retryAfterSeconds` must
 * be OMITTED rather than set to `undefined` when absent, hence the
 * conditional spread instead of always including the key.
 */
function providerFailure(res: Response): { ok: false; retryable: boolean; retryAfterSeconds?: number; reason: string } {
  const { retryable } = classifyStatus(res.status);
  const retryAfterSeconds = parseRetryAfterHeader(res);
  const reason = `provider error (status ${String(res.status)})`;
  return retryAfterSeconds === undefined
    ? { ok: false, retryable, reason }
    : { ok: false, retryable, retryAfterSeconds, reason };
}

export class AnthropicModelClient implements ModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly backoffDeps: BackoffDeps;

  constructor(options: AnthropicClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.backoffDeps = options.backoffDeps ?? {};
  }

  async runTrial(plan: RequestPlan, _attempt: number, modelIdRequested: string): Promise<TrialResult> {
    // SPEC §9 "Model id 404 / retired": detected and returned directly,
    // never routed through the generic retry ladder — a 404 means the
    // requested model doesn't exist, which retrying cannot fix. Tracked via
    // an object property (not a bare `let`) so the closure's mutation is
    // visible without tripping a false-positive "always falsy" narrowing
    // warning across the async-callback boundary.
    const state = { modelUnavailable: false };
    const outcome = await withFullJitterRetry<ModelTrialResponse>(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: headers(this.apiKey),
        body: JSON.stringify(requestBody(plan, modelIdRequested)),
      });
      if (res.ok) {
        const body = (await res.json()) as AnthropicMessageResponse;
        return { ok: true, value: toModelTrialResponse(body, modelIdRequested) };
      }
      state.modelUnavailable = classifyStatus(res.status).modelUnavailable;
      return providerFailure(res);
    }, this.backoffDeps);

    if (outcome.ok) return { outcome: "ok", response: outcome.value };
    return state.modelUnavailable
      ? { outcome: "noResult", reason: outcome.reason, modelUnavailable: true }
      : { outcome: "noResult", reason: outcome.reason };
  }

  async countTokens(plan: RequestPlan, modelIdRequested: string): Promise<TokenCountResult> {
    const outcome = await withFullJitterRetry<TokenCountResult>(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/messages/count_tokens`, {
        method: "POST",
        headers: headers(this.apiKey),
        body: JSON.stringify(requestBody(plan, modelIdRequested)),
      });
      if (res.ok) {
        const body = (await res.json()) as { input_tokens?: number };
        return { ok: true, value: { inputTokens: body.input_tokens ?? 0 } };
      }
      return providerFailure(res);
    }, this.backoffDeps);
    if (outcome.ok) return outcome.value;
    throw new TiltmeterError("E_PROVIDER", `count_tokens failed: ${outcome.reason}`);
  }

  async submitBatch(requests: BatchRequestItem[], modelIdRequested: string): Promise<{ batchId: string }> {
    const body = {
      requests: requests.map((r) => ({ custom_id: r.customId, params: requestBody(r.plan, modelIdRequested) })),
    };
    const outcome = await withFullJitterRetry<{ batchId: string }>(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/messages/batches`, {
        method: "POST",
        headers: headers(this.apiKey),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const parsed = (await res.json()) as { id?: string };
        if (parsed.id === undefined) return { ok: false, retryable: false, reason: "batch submission response missing id" };
        return { ok: true, value: { batchId: parsed.id } };
      }
      return providerFailure(res);
    }, this.backoffDeps);
    if (outcome.ok) return outcome.value;
    throw new TiltmeterError("E_PROVIDER", `batch submission failed: ${outcome.reason}`);
  }

  async pollBatch(batchId: string): Promise<BatchPollResult> {
    const outcome = await withFullJitterRetry<BatchPollResult>(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/messages/batches/${batchId}`, {
        method: "GET",
        headers: headers(this.apiKey),
      });
      if (res.ok) {
        const parsed = (await res.json()) as { processing_status?: string };
        return { ok: true, value: { ended: parsed.processing_status === "ended" } };
      }
      return providerFailure(res);
    }, this.backoffDeps);
    if (outcome.ok) return outcome.value;
    throw new TiltmeterError("E_PROVIDER", `batch poll failed: ${outcome.reason}`);
  }

  async fetchBatchResults(batchId: string): Promise<BatchResultItem[]> {
    const outcome = await withFullJitterRetry<BatchResultItem[]>(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/messages/batches/${batchId}/results`, {
        method: "GET",
        headers: headers(this.apiKey),
      });
      if (res.ok) {
        const text = await res.text();
        return { ok: true, value: parseBatchResultsJsonl(text) };
      }
      return providerFailure(res);
    }, this.backoffDeps);
    if (outcome.ok) return outcome.value;
    throw new TiltmeterError("E_PROVIDER", `batch results fetch failed: ${outcome.reason}`);
  }
}

/** SPEC §9 "Retry-After honoured". */
function parseRetryAfterHeader(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (raw === null) return undefined;
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) && asNumber >= 0 ? asNumber : undefined;
}

interface BatchResultLine {
  custom_id: string;
  result:
    | { type: "succeeded"; message: AnthropicMessageResponse }
    | { type: "errored"; error?: { message?: string } }
    | { type: "canceled" }
    | { type: "expired" };
}

/** The Message Batches API's results endpoint returns newline-delimited JSON, one line per submitted request (SPEC §9's batch-expiry row is exactly `type: "expired"` here). Never-succeeded lines become `noResult` — batch failures are DATA, not thrown exceptions, so `core/batch.ts`'s retry-the-failed-subset logic can treat them uniformly. */
export function parseBatchResultsJsonl(text: string): BatchResultItem[] {
  const out: BatchResultItem[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parsed = JSON.parse(trimmed) as BatchResultLine;
    const result: TrialResult =
      parsed.result.type === "succeeded"
        ? { outcome: "ok", response: toModelTrialResponse(parsed.result.message, "") }
        : { outcome: "noResult", reason: `batch-${parsed.result.type}` };
    out.push({ customId: parsed.custom_id, result });
  }
  return out;
}

