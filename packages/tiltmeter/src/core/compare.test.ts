import { describe, expect, it } from "vitest";
import { compareReadings, worstMetricVerdict } from "./compare.js";
import type { Reading } from "./reading.js";

function reading(metrics: Record<string, number>, itemIds: string[], overrides: Partial<Reading> = {}): Reading {
  return {
    formatVersion: 1,
    runGroupId: "rg-1",
    suiteId: "suite-a",
    cellId: "cell-a",
    axes: {
      suiteSpecHash: "hash-suite",
      modelIdRequested: "model-a",
      modelIdResolved: "model-a",
      aliasUsed: false,
      runnerBehaviorVersion: 1,
      presentationHash: "hash-presentation",
      samplingPolicyHash: "hash-sampling",
    },
    harnessCommit: "0000000000000000000000000000000000000",
    runnerVersion: "0.1.0-alpha.0",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:00:01.000Z",
    status: "complete",
    completeness: { expectedTrials: itemIds.length * 3, ok: itemIds.length * 3, error: 0, noResult: 0 },
    metrics,
    items: itemIds.map((id) => ({ id, k: 3, passes: 3, trials: [] })),
    bodyHash: "sha256:deadbeef",
    ...overrides,
  };
}

const ITEMS = Array.from({ length: 40 }, (_, i) => `item-${String(i + 1)}`);

describe("compareReadings (M1: mean delta, no axis gate yet)", () => {
  it("classifies regressed when the mean delta is negative and beyond MDE", () => {
    const a = reading({ overall: 1.0 }, ITEMS);
    const b = reading({ overall: 0.7 }, ITEMS);
    const cmp = compareReadings(a, b);
    expect(cmp.verdict).toBe("regressed");
    expect(cmp.metrics[0]?.delta).toBeCloseTo(-0.3, 10);
  });

  it("classifies improved when the mean delta is positive and beyond MDE", () => {
    const a = reading({ overall: 0.7 }, ITEMS);
    const b = reading({ overall: 1.0 }, ITEMS);
    const cmp = compareReadings(a, b);
    expect(cmp.verdict).toBe("improved");
  });

  it("classifies moved-within-noise for a zero delta", () => {
    const a = reading({ overall: 0.9 }, ITEMS);
    const b = reading({ overall: 0.9 }, ITEMS);
    expect(compareReadings(a, b).verdict).toBe("moved-within-noise");
  });

  it("classifies moved-within-noise for a delta below MDE (near-miss, false-positive discipline)", () => {
    // MDE = 1/40 = 0.025 for a 40-item suite; a 1-item flip is 1/40 exactly, not below it —
    // use a smaller nudge to stay strictly under the threshold.
    const a = reading({ overall: 0.9 }, ITEMS);
    const b = reading({ overall: 0.9 + 1 / 40 - 0.001 }, ITEMS);
    expect(compareReadings(a, b).verdict).toBe("moved-within-noise");
  });

  it("a suite's verdict is the WORST of its declared metrics", () => {
    const a = reading({ overall: 0.9, triggerRate: 0.9, falsePositiveRate: 0.1 }, ITEMS);
    const b = reading({ overall: 0.9, triggerRate: 0.9, falsePositiveRate: 0.4 }, ITEMS); // FPR got worse
    const cmp = compareReadings(a, b);
    expect(cmp.verdict).toBe("regressed");
    const fpr = cmp.metrics.find((m) => m.metric === "falsePositiveRate");
    expect(fpr?.verdict).toBe("regressed");
  });

  it("only compares metrics present on both readings", () => {
    const a = reading({ overall: 0.9, extraOnA: 1 }, ITEMS);
    const b = reading({ overall: 0.9 }, ITEMS);
    const cmp = compareReadings(a, b);
    expect(cmp.metrics.map((m) => m.metric)).toEqual(["overall"]);
  });

  it("falls back to moved-within-noise when there are no common metrics", () => {
    const a = reading({ onlyA: 1 }, ITEMS);
    const b = reading({ onlyB: 1 }, ITEMS);
    expect(compareReadings(a, b).verdict).toBe("moved-within-noise");
  });
});

describe("worstMetricVerdict", () => {
  it("ranks regressed worst, then moved-within-noise, then improved best", () => {
    expect(worstMetricVerdict(["improved", "moved-within-noise", "regressed"])).toBe("regressed");
    expect(worstMetricVerdict(["improved", "moved-within-noise"])).toBe("moved-within-noise");
    expect(worstMetricVerdict(["improved"])).toBe("improved");
    expect(worstMetricVerdict([])).toBe("improved");
  });
});
