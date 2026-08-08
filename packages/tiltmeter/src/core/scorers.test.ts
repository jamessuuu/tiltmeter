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
