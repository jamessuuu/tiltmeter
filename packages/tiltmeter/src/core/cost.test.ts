import { describe, expect, it } from "vitest";
import type { RequestPlan } from "./model-client.js";
import { offlineEstimatedInputTokens } from "./cost.js";

function plan(overrides: Partial<RequestPlan> = {}): RequestPlan {
  return {
    itemId: "item-1",
    system: "You are an agent.",
    tools: [],
    toolChoice: { type: "auto" },
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 512,
    temperature: 1,
    ...overrides,
  };
}

describe("offlineEstimatedInputTokens (SPEC §7 --offline heuristic)", () => {
  it("is deterministic for identical input", () => {
    const p = plan();
    expect(offlineEstimatedInputTokens(p, 1.0)).toBe(offlineEstimatedInputTokens(p, 1.0));
  });

  it("scales with request length", () => {
    const short = offlineEstimatedInputTokens(plan({ system: "short" }), 1.0);
    const long = offlineEstimatedInputTokens(plan({ system: "a".repeat(1000) }), 1.0);
    expect(long).toBeGreaterThan(short);
  });

  it("applies the pricing manifest's estimateMultiplier (SPEC §8: Fable 5 at 1.3x)", () => {
    const p = plan();
    const base = offlineEstimatedInputTokens(p, 1.0);
    const inflated = offlineEstimatedInputTokens(p, 1.3);
    expect(inflated).toBeGreaterThan(base);
    expect(inflated).toBe(Math.ceil(base * 1.3));
  });

  it("counts tool schemas toward the estimate", () => {
    const withoutTools = offlineEstimatedInputTokens(plan(), 1.0);
    const withTools = offlineEstimatedInputTokens(
      plan({ tools: [{ name: "Skill", input_schema: { type: "object", properties: {} } }] }),
      1.0,
    );
    expect(withTools).toBeGreaterThan(withoutTools);
  });

  it("never returns zero for a non-empty request", () => {
    expect(offlineEstimatedInputTokens(plan(), 1.0)).toBeGreaterThan(0);
  });
});
