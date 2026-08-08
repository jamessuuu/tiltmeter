import { describe, expect, it } from "vitest";
import { buildSeries, buildSeriesByCellId, formatPercentagePoints, shortHash } from "./instrument.js";

function reading(overrides: {
  runGroupId: string;
  cellId: string;
  suiteSpecHash: string;
  startedAt: string;
  status?: string;
}) {
  return {
    formatVersion: 1 as const,
    runGroupId: overrides.runGroupId,
    suiteId: "demo-suite",
    cellId: overrides.cellId,
    axes: {
      suiteSpecHash: overrides.suiteSpecHash,
      modelIdRequested: "claude-haiku-4-5",
      modelIdResolved: "claude-haiku-4-5",
      aliasUsed: false,
      runnerBehaviorVersion: 1,
      presentationHash: "ph",
      samplingPolicyHash: "sh",
    },
    harnessCommit: "0000000000000000000000000000000000000",
    runnerVersion: "1.0.0-rc.1",
    startedAt: overrides.startedAt,
    finishedAt: overrides.startedAt,
    status: (overrides.status ?? "complete") as "complete",
    completeness: { expectedTrials: 3, ok: 3, error: 0, noResult: 0 },
    metrics: { overall: 0.9 },
    items: [],
    bodyHash: "sha256:deadbeef",
  };
}

describe("buildSeries — SPEC §4/§10 hard breaks", () => {
  it("sorts oldest first regardless of input order", () => {
    const series = buildSeries([
      reading({ runGroupId: "rg-2", cellId: "haiku45", suiteSpecHash: "h1", startedAt: "2026-08-15T00:00:00Z" }),
      reading({ runGroupId: "rg-1", cellId: "haiku45", suiteSpecHash: "h1", startedAt: "2026-08-08T00:00:00Z" }),
    ]);
    expect(series.map((s) => s.runGroupId)).toEqual(["rg-1", "rg-2"]);
  });

  it("the first point never has a hard break, even with only one point", () => {
    const series = buildSeries([reading({ runGroupId: "rg-1", cellId: "haiku45", suiteSpecHash: "h1", startedAt: "2026-08-08T00:00:00Z" })]);
    expect(series[0]?.hardBreakBefore).toBe(false);
  });

  it("flags a hard break exactly where suiteSpecHash changes, and nowhere else", () => {
    const series = buildSeries([
      reading({ runGroupId: "rg-1", cellId: "haiku45", suiteSpecHash: "h1", startedAt: "2026-08-01T00:00:00Z" }),
      reading({ runGroupId: "rg-2", cellId: "haiku45", suiteSpecHash: "h1", startedAt: "2026-08-08T00:00:00Z" }),
      reading({ runGroupId: "rg-3", cellId: "haiku45", suiteSpecHash: "h2", startedAt: "2026-08-15T00:00:00Z" }),
      reading({ runGroupId: "rg-4", cellId: "haiku45", suiteSpecHash: "h2", startedAt: "2026-08-22T00:00:00Z" }),
    ]);
    expect(series.map((s) => s.hardBreakBefore)).toEqual([false, false, true, false]);
  });
});

describe("buildSeriesByCellId", () => {
  it("groups readings by cellId into independent series", () => {
    const byCellId = buildSeriesByCellId([
      reading({ runGroupId: "rg-1", cellId: "haiku45", suiteSpecHash: "h1", startedAt: "2026-08-01T00:00:00Z" }),
      reading({ runGroupId: "rg-1", cellId: "sonnet5", suiteSpecHash: "h1", startedAt: "2026-08-01T00:00:00Z" }),
    ]);
    expect([...byCellId.keys()].sort()).toEqual(["haiku45", "sonnet5"]);
    expect(byCellId.get("haiku45")).toHaveLength(1);
  });
});

describe("shortHash", () => {
  it("truncates to 7 characters, git-log style", () => {
    expect(shortHash("6e882b3794e8abcdef")).toBe("6e882b3");
  });
});

describe("formatPercentagePoints", () => {
  it("formats a positive delta with a + sign", () => {
    expect(formatPercentagePoints(0.082)).toBe("+8.2pp");
  });

  it("formats a negative delta with a minus sign", () => {
    expect(formatPercentagePoints(-0.082)).toBe("−8.2pp");
  });

  it("formats zero with no sign", () => {
    expect(formatPercentagePoints(0)).toBe("0.0pp");
  });
});
