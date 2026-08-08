import { describe, expect, it } from "vitest";
import type { ModelTrialResponse } from "./model-client.js";
import { score } from "./scorers.js";

function response(overrides: Partial<ModelTrialResponse> = {}): ModelTrialResponse {
  return {
    stopReason: "end_turn",
    toolUseBlocks: [],
    usage: { in: 10, out: 5 },
    modelIdResolved: "fake-model-1",
    ...overrides,
  };
}

describe("tool-called", () => {
  const expect_ = { scorer: "tool-called" as const, name: "Skill", args: { skill: "taste" } };

  it("passes when the first tool_use matches name and is a superset of args", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "Skill", input: { skill: "taste", extra: 1 } }],
    });
    expect(score(r, expect_).outcome).toBe("pass");
  });

  it("fails when the tool name differs", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "Other", input: { skill: "taste" } }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });

  it("fails when a required arg is missing or differs", () => {
    const wrongArg = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "Skill", input: { skill: "other-skill" } }],
    });
    expect(score(wrongArg, expect_).outcome).toBe("fail");

    const missingArg = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "Skill", input: {} }],
    });
    expect(score(missingArg, expect_).outcome).toBe("fail");
  });

  it("fails when no tool was called", () => {
    expect(score(response(), expect_).outcome).toBe("fail");
  });

  it("only reads the FIRST tool_use block — a correct second block does not rescue a wrong first one", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [
        { type: "tool_use", name: "Wrong", input: {} },
        { type: "tool_use", name: "Skill", input: { skill: "taste" } },
      ],
    });
    const result = score(r, expect_);
    expect(result.outcome).toBe("fail");
    expect(result.firstTool).toBe("Wrong");
  });

  it("matches an object-valued arg by deep equality, not reference", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "Skill", input: { skill: "taste", nested: { a: 1 } } }],
    });
    const expectNested = { scorer: "tool-called" as const, name: "Skill", args: { nested: { a: 1 } } };
    expect(score(r, expectNested).outcome).toBe("pass");
  });
});

describe("no-tool-called", () => {
  const expect_ = { scorer: "no-tool-called" as const };

  it("passes when no tool was called", () => {
    expect(score(response(), expect_).outcome).toBe("pass");
  });

  it("fails when any tool was called, regardless of which", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "Anything", input: {} }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });
});

describe("tool-in-set", () => {
  const expect_ = { scorer: "tool-in-set" as const, names: ["ToolA", "ToolB"] };

  it("passes when the first tool_use name is in the set", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "ToolB", input: {} }],
    });
    expect(score(r, expect_).outcome).toBe("pass");
  });

  it("fails when the first tool_use name is not in the set", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "ToolC", input: {} }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });

  it("fails when no tool was called", () => {
    expect(score(response(), expect_).outcome).toBe("fail");
  });
});

describe("arg-enum", () => {
  const expect_ = { scorer: "arg-enum" as const, name: "decline", key: "reason_code", values: ["out-of-scope", "needs-human"] };

  it("passes when the arg value is a member of the declared set", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "decline", input: { reason_code: "needs-human" } }],
    });
    expect(score(r, expect_).outcome).toBe("pass");
  });

  it("fails when the arg value is not a member", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "decline", input: { reason_code: "made-up-reason" } }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });

  it("fails when the tool name differs, even with a valid-looking value elsewhere", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "other-tool", input: { reason_code: "needs-human" } }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });
});

describe("arg-required-keys", () => {
  const expect_ = { scorer: "arg-required-keys" as const, name: "emit", keys: ["title", "body"] };

  it("passes when every required key is present, regardless of value", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "emit", input: { title: "", body: "x", extra: 1 } }],
    });
    expect(score(r, expect_).outcome).toBe("pass");
  });

  it("fails when a required key is missing", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "emit", input: { title: "only this" } }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });
});

describe("tool-order", () => {
  const expect_ = { scorer: "tool-order" as const, names: ["route", "split_task"] };

  it("passes on an exact ordered match of the FULL sequence", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [
        { type: "tool_use", name: "route", input: {} },
        { type: "tool_use", name: "split_task", input: {} },
      ],
    });
    expect(score(r, expect_).outcome).toBe("pass");
  });

  it("fails on the right names in the wrong order", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [
        { type: "tool_use", name: "split_task", input: {} },
        { type: "tool_use", name: "route", input: {} },
      ],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });

  it("fails when the sequence is a prefix but not the full match", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "route", input: {} }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });

  it("fails when extra calls follow a correct prefix", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [
        { type: "tool_use", name: "route", input: {} },
        { type: "tool_use", name: "split_task", input: {} },
        { type: "tool_use", name: "extra", input: {} },
      ],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });
});

describe("literal-prefix", () => {
  const expect_ = { scorer: "literal-prefix" as const, prefix: "ROUTE:" };

  it("passes when the text starts with the literal prefix", () => {
    expect(score(response({ text: "ROUTE: personal" }), expect_).outcome).toBe("pass");
  });

  it("fails when the text does not start with it", () => {
    expect(score(response({ text: "Sure, routing to personal" }), expect_).outcome).toBe("fail");
  });

  it("fails when there is no text at all", () => {
    expect(score(response(), expect_).outcome).toBe("fail");
  });

  it("is a byte-literal comparison, not case-insensitive", () => {
    expect(score(response({ text: "route: personal" }), expect_).outcome).toBe("fail");
  });
});

describe("json-schema-valid", () => {
  const expect_ = {
    scorer: "json-schema-valid" as const,
    name: "emit_verdict",
    schema: {
      type: "object",
      required: ["verdict", "reasons"],
      properties: {
        verdict: { type: "string", enum: ["SHIP", "FIX", "RECONCEIVE"] },
        reasons: { type: "array", items: { type: "string" } },
      },
    },
  };

  it("passes on a structurally valid object", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "emit_verdict", input: { verdict: "SHIP", reasons: ["clean"] } }],
    });
    expect(score(r, expect_).outcome).toBe("pass");
  });

  it("fails when a required property is missing", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "emit_verdict", input: { verdict: "SHIP" } }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });

  it("fails when a property's enum value is not one of the declared options", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "emit_verdict", input: { verdict: "MAYBE", reasons: [] } }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });

  it("fails when an array property's items are the wrong type", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "emit_verdict", input: { verdict: "SHIP", reasons: [42] } }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });

  it("fails when the wrong tool was called", () => {
    const r = response({
      stopReason: "tool_use",
      toolUseBlocks: [{ type: "tool_use", name: "other", input: { verdict: "SHIP", reasons: [] } }],
    });
    expect(score(r, expect_).outcome).toBe("fail");
  });
});
