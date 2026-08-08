/**
 * Offline cost-estimation heuristic (SPEC §7 `plan --offline`: "falls back
 * to the manifest's `estimateMultiplier` and marks the estimate
 * `approximate`"). `core/plan.ts` prefers `client.countTokens` whenever a
 * client is present — this module exists ONLY for the no-client path, so a
 * plan can still be built (and cap-checked) with zero network and zero key.
 */
import type { RequestPlan } from "./model-client.js";

/** Characters-per-token approximation for English prose + JSON tool schemas — a common rough constant, good enough for an `approximate`-flagged estimate, never used once a real `count_tokens` result is available. */
const CHARS_PER_TOKEN_BASELINE = 4;

/** The exact text/shape a real request would render (system + tools + tool_choice + the scenario message) — the same surface `count_tokens` would price, approximated by length instead of tokenized. */
function renderedRequestText(plan: RequestPlan): string {
  return (
    plan.system +
    JSON.stringify(plan.tools) +
    JSON.stringify(plan.toolChoice) +
    plan.messages.map((m) => m.content).join("\n")
  );
}

/**
 * Pure chars/`CHARS_PER_TOKEN_BASELINE` estimate of one request's input
 * tokens, scaled by the pricing manifest's per-model `estimateMultiplier`
 * (SPEC §7/§8: the one named case is Fable 5 at 1.3x for the 4.7+
 * tokenizer). Never used once a real `count_tokens` call is available —
 * `core/plan.ts`'s `buildPlan` only calls this in `--offline` mode.
 */
export function offlineEstimatedInputTokens(plan: RequestPlan, estimateMultiplier: number): number {
  const baseline = Math.ceil(renderedRequestText(plan).length / CHARS_PER_TOKEN_BASELINE);
  return Math.ceil(baseline * estimateMultiplier);
}
