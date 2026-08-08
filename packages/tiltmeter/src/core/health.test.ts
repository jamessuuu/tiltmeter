import { describe, expect, it } from "vitest";
import { computeHealthState, HEALTH_STALE_THRESHOLD_DAYS, newestRealReadingAt } from "./health.js";

describe("computeHealthState", () => {
  it("is not stale and reports null days when there has never been a reading", () => {
    expect(computeHealthState(undefined, "2026-08-20T00:00:00Z")).toEqual({
      stale: false,
      daysSinceNewestReading: null,
    });
  });

  it("is not stale exactly at the threshold boundary", () => {
    const state = computeHealthState("2026-08-01T00:00:00Z", "2026-08-15T00:00:00Z");
    expect(state.daysSinceNewestReading).toBe(14);
    expect(state.stale).toBe(false);
  });

  it("is stale one day past the threshold", () => {
    const state = computeHealthState("2026-08-01T00:00:00Z", "2026-08-16T00:00:01Z");
    expect(state.daysSinceNewestReading).toBe(15);
    expect(state.stale).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(computeHealthState("2026-08-01T00:00:00Z", "2026-08-04T00:00:00Z", 2).stale).toBe(true);
    expect(HEALTH_STALE_THRESHOLD_DAYS).toBe(14);
  });
});

describe("newestRealReadingAt", () => {
  it("returns undefined when there are no entries at all", () => {
    expect(newestRealReadingAt([])).toBeUndefined();
  });

  it("ignores skipped entries (empty cells) — a mitigation commit is not a reading", () => {
    const entries = [
      { at: "2026-08-10T00:00:00Z", cells: [] },
      { at: "2026-08-17T00:00:00Z", cells: [] },
    ];
    expect(newestRealReadingAt(entries)).toBeUndefined();
  });

  it("picks the newest entry among those that produced real readings", () => {
    const entries = [
      { at: "2026-08-01T00:00:00Z", cells: [{ suiteId: "a", cellId: "b", bodyHash: "h" }] },
      { at: "2026-08-15T00:00:00Z", cells: [] }, // a later skipped week — must not win
      { at: "2026-08-08T00:00:00Z", cells: [{ suiteId: "a", cellId: "b", bodyHash: "h2" }] },
    ];
    expect(newestRealReadingAt(entries)).toBe("2026-08-08T00:00:00Z");
  });
});
