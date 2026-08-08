/**
 * Deterministic scorers (SPEC §3.2). "Scoring reads the FIRST `tool_use`
 * block (full list recorded; `tool-order` uses the list)." M1 implements
 * the three scorers its walking-skeleton gate needs: `tool-called`,
 * `no-tool-called`, `tool-in-set`. House rule (METHODOLOGY.md, SPEC §3.2):
 * "a scorer that must interpret prose means the probe is wrong" — every
 * scorer here is a structural check over `toolUseBlocks`, never a read of
 * assistant prose.
 */
import type { Expect } from "./suite.js";
import type { ModelTrialResponse, ToolUseBlock } from "./model-client.js";

export type TrialOutcome = "pass" | "fail";

export interface ScoreResult {
  outcome: TrialOutcome;
  /** The first tool_use block's name, if any — recorded on the trial regardless of pass/fail. */
  firstTool: string | undefined;
  /** The first tool_use block's args, if any. */
  firstArgs: Record<string, unknown> | undefined;
}

function firstToolUse(response: ModelTrialResponse): ToolUseBlock | undefined {
  return response.toolUseBlocks[0];
}

/** True if every key/value pair in `subset` is present and `===`-equal in `full`. Nested objects compare by JSON equality. */
function isArgsSubset(subset: Record<string, unknown>, full: Record<string, unknown>): boolean {
  for (const key of Object.keys(subset)) {
    if (!(key in full)) return false;
    const expected = subset[key];
    const actual = full[key];
    if (typeof expected === "object" && expected !== null) {
      if (JSON.stringify(expected) !== JSON.stringify(actual)) return false;
    } else if (expected !== actual) {
      return false;
    }
  }
  return true;
}

function scoreToolCalled(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "tool-called" }>,
): ScoreResult {
  const first = firstToolUse(response);
  const firstTool = first?.name;
  const firstArgs = first?.input;
  if (first?.name !== expect.name) {
    return { outcome: "fail", firstTool, firstArgs };
  }
  if (expect.args !== undefined && !isArgsSubset(expect.args, first.input)) {
    return { outcome: "fail", firstTool, firstArgs };
  }
  return { outcome: "pass", firstTool, firstArgs };
}

function scoreNoToolCalled(response: ModelTrialResponse): ScoreResult {
  const first = firstToolUse(response);
  return {
    outcome: first === undefined ? "pass" : "fail",
    firstTool: first?.name,
    firstArgs: first?.input,
  };
}

function scoreToolInSet(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "tool-in-set" }>,
): ScoreResult {
  const first = firstToolUse(response);
  const firstTool = first?.name;
  const firstArgs = first?.input;
  if (first === undefined) return { outcome: "fail", firstTool, firstArgs };
  return { outcome: expect.names.includes(first.name) ? "pass" : "fail", firstTool, firstArgs };
}

/** Score one trial response against an item's `expect`. Throws for scorer kinds not yet implemented (SPEC §3.1 note in suite.ts). */
export function score(response: ModelTrialResponse, expect: Expect): ScoreResult {
  switch (expect.scorer) {
    case "tool-called":
      return scoreToolCalled(response, expect);
    case "no-tool-called":
      return scoreNoToolCalled(response);
    case "tool-in-set":
      return scoreToolInSet(response, expect);
  }
}
