import { describe, expect, it } from "vitest";
import type { RequestPlan } from "../core/model-client.js";
import { FakeModelClient, noResultTrial, noToolTrial, toolUseTrial } from "./fake-model-client.js";

function plan(itemId: string): RequestPlan {
  return {
    itemId,
    system: "sys",
    tools: [],
    toolChoice: { type: "auto" },
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 512,
    temperature: 1,
  };
}

describe("FakeModelClient", () => {
  it("returns the scripted result for a given (itemId, attempt)", async () => {
    const client = new FakeModelClient({
      script: { "item-1": { 1: toolUseTrial("Skill", { skill: "taste" }) } },
    });
    const result = await client.runTrial(plan("item-1"), 1, "fake-model-1");
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      expect(result.response.toolUseBlocks[0]?.name).toBe("Skill");
    }
  });

  it("distinguishes attempts on the same item", async () => {
    const client = new FakeModelClient({
      script: { "item-1": { 1: toolUseTrial("Skill", {}), 2: noToolTrial() } },
    });
    const first = await client.runTrial(plan("item-1"), 1, "fake-model-1");
    const second = await client.runTrial(plan("item-1"), 2, "fake-model-1");
    expect(first.outcome === "ok" && first.response.toolUseBlocks.length).toBe(1);
    expect(second.outcome === "ok" && second.response.toolUseBlocks.length).toBe(0);
  });

  it("falls back to a default (no tool called) when unscripted", async () => {
    const client = new FakeModelClient({ script: {} });
    const result = await client.runTrial(plan("unscripted-item"), 1, "fake-model-1");
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      expect(result.response.toolUseBlocks).toHaveLength(0);
    }
  });

  it("honors a custom fallback", async () => {
    const client = new FakeModelClient({ script: {}, fallback: noResultTrial("no script") });
    const result = await client.runTrial(plan("unscripted-item"), 1, "fake-model-1");
    expect(result.outcome).toBe("noResult");
  });

  it("can script a noResult trial", async () => {
    const client = new FakeModelClient({
      script: { "item-1": { 1: noResultTrial("simulated 529, retries exhausted") } },
    });
    const result = await client.runTrial(plan("item-1"), 1, "fake-model-1");
    expect(result).toEqual({ outcome: "noResult", reason: "simulated 529, retries exhausted" });
  });
});
