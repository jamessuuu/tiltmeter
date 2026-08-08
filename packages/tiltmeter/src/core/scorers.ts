/**
 * Deterministic scorers (SPEC §3.2). "Scoring reads the FIRST `tool_use`
 * block (full list recorded; `tool-order` uses the list)." M1 implemented
 * `tool-called`, `no-tool-called`, `tool-in-set`; M5 adds the remaining
 * five — `arg-enum`, `arg-required-keys`, `tool-order`, `literal-prefix`,
 * `json-schema-valid` — for the real observatory suites. House rule
 * (METHODOLOGY.md, SPEC §3.2): "a scorer that must interpret prose means
 * the probe is wrong" — every scorer here is a structural check over
 * `toolUseBlocks` (or, for `literal-prefix` only, a literal string
 * comparison against `text` — never a read of assistant prose for meaning).
 */
import type { Expect } from "./suite.js";
import type { JsonObject } from "./canonical.js";
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

function withFirst(response: ModelTrialResponse, outcome: TrialOutcome): ScoreResult {
  const first = firstToolUse(response);
  return { outcome, firstTool: first?.name, firstArgs: first?.input };
}

function scoreToolCalled(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "tool-called" }>,
): ScoreResult {
  const first = firstToolUse(response);
  if (first?.name !== expect.name) return withFirst(response, "fail");
  if (expect.args !== undefined && !isArgsSubset(expect.args, first.input)) return withFirst(response, "fail");
  return withFirst(response, "pass");
}

function scoreNoToolCalled(response: ModelTrialResponse): ScoreResult {
  return withFirst(response, firstToolUse(response) === undefined ? "pass" : "fail");
}

function scoreToolInSet(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "tool-in-set" }>,
): ScoreResult {
  const first = firstToolUse(response);
  if (first === undefined) return withFirst(response, "fail");
  return withFirst(response, expect.names.includes(first.name) ? "pass" : "fail");
}

/** SPEC §3.2 `tool-selection`: does the first call's argument at `key` fall in the declared enum (e.g. a `refusal-shape` item's `decline` call carrying `reason_code ∈ {...}`). */
function scoreArgEnum(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "arg-enum" }>,
): ScoreResult {
  const first = firstToolUse(response);
  if (first?.name !== expect.name) return withFirst(response, "fail");
  const actual = first.input[expect.key];
  const isMember = (expect.values as readonly unknown[]).includes(actual);
  return withFirst(response, isMember ? "pass" : "fail");
}

/** SPEC §3.2 `tool-selection`/`output-format`: does the first call carry every key a downstream consumer requires, regardless of value. */
function scoreArgRequiredKeys(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "arg-required-keys" }>,
): ScoreResult {
  const first = firstToolUse(response);
  if (first?.name !== expect.name) return withFirst(response, "fail");
  const hasAll = expect.keys.every((key) => key in first.input);
  return withFirst(response, hasAll ? "pass" : "fail");
}

/** SPEC §3.2 `instruction-adherence`: does the FULL sequence of tool calls exactly match the declared order — not just the first block, so this is the one scorer that looks past `toolUseBlocks[0]`. */
function scoreToolOrder(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "tool-order" }>,
): ScoreResult {
  const actualNames = response.toolUseBlocks.map((b) => b.name);
  const outcome: TrialOutcome =
    actualNames.length === expect.names.length && actualNames.every((n, i) => n === expect.names[i])
      ? "pass"
      : "fail";
  return withFirst(response, outcome);
}

/** SPEC §3.2 `instruction-adherence`: a LITERAL prefix check on the response's text — never prose interpretation, only a control token an instruction explicitly demands. */
function scoreLiteralPrefix(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "literal-prefix" }>,
): ScoreResult {
  const outcome: TrialOutcome = (response.text ?? "").startsWith(expect.prefix) ? "pass" : "fail";
  return withFirst(response, outcome);
}

/**
 * Minimal JSON-Schema-subset structural validator (SPEC §3.2
 * `output-format`'s "is my downstream contract still satisfiable" —
 * `core/suite.ts`'s own header comment documents the deliberately-limited
 * subset: `type`/`required`/`properties`/`enum`/`items` only). Permissive
 * on anything outside that subset (an unrecognized `type` value or a schema
 * keyword this validator does not implement never fails a trial on its
 * own) — a false PASS from an under-specified schema is the suite author's
 * problem to tighten; a false FAIL from an unimplemented keyword would be
 * this scorer's bug.
 */
function validatesAgainstSchema(value: unknown, schema: JsonObject): boolean {
  const type = schema.type;
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required) : [];
    for (const key of required) {
      if (typeof key === "string" && !(key in obj)) return false;
    }
    const properties = schema.properties;
    if (properties !== undefined && typeof properties === "object" && !Array.isArray(properties)) {
      for (const [key, subSchema] of Object.entries(properties as JsonObject)) {
        if (key in obj && typeof subSchema === "object" && subSchema !== null && !Array.isArray(subSchema)) {
          if (!validatesAgainstSchema(obj[key], subSchema)) return false;
        }
      }
    }
    return true;
  }
  if (type === "string") {
    if (typeof value !== "string") return false;
    if (Array.isArray(schema.enum)) return (schema.enum).includes(value);
    return true;
  }
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") {
    if (!Array.isArray(value)) return false;
    const items = schema.items;
    if (items !== undefined && typeof items === "object" && items !== null && !Array.isArray(items)) {
      return value.every((v) => validatesAgainstSchema(v, items));
    }
    return true;
  }
  return true; // unrecognized/absent `type` — permissive, never a silent false fail
}

function scoreJsonSchemaValid(
  response: ModelTrialResponse,
  expect: Extract<Expect, { scorer: "json-schema-valid" }>,
): ScoreResult {
  const first = firstToolUse(response);
  if (first?.name !== expect.name) return withFirst(response, "fail");
  return withFirst(response, validatesAgainstSchema(first.input, expect.schema) ? "pass" : "fail");
}

/** Score one trial response against an item's `expect`. */
export function score(response: ModelTrialResponse, expect: Expect): ScoreResult {
  switch (expect.scorer) {
    case "tool-called":
      return scoreToolCalled(response, expect);
    case "no-tool-called":
      return scoreNoToolCalled(response);
    case "tool-in-set":
      return scoreToolInSet(response, expect);
    case "arg-enum":
      return scoreArgEnum(response, expect);
    case "arg-required-keys":
      return scoreArgRequiredKeys(response, expect);
    case "tool-order":
      return scoreToolOrder(response, expect);
    case "literal-prefix":
      return scoreLiteralPrefix(response, expect);
    case "json-schema-valid":
      return scoreJsonSchemaValid(response, expect);
  }
}
