import { describe, expect, it } from "vitest";
import { computeDeadManState, DEAD_MAN_THRESHOLD_DAYS, newestReadingTimestamp } from "./dead-man.js";

const READING_TIME = "2026-08-01T00:00:00.000Z";

function daysLater(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

describe("computeDeadManState (SPEC §8/§10: dead-man banner >10 days old)", () => {
  it("no readings at all -> not stale, null age (a distinct, honest state — SPEC §11's launch copy owns it)", () => {
    const state = computeDeadManState(undefined, READING_TIME);
    expect(state).toEqual({ stale: false, daysSinceNewestReading: null });
  });

  it("brand new reading (0 days old) -> not stale", () => {
    const state = computeDeadManState(READING_TIME, READING_TIME);
    expect(state.stale).toBe(false);
    expect(state.daysSinceNewestReading).toBe(0);
  });

  it("exactly at the 10-day boundary -> NOT stale (the rule is strictly >10, not >=10)", () => {
    const now = daysLater(READING_TIME, DEAD_MAN_THRESHOLD_DAYS);
    const state = computeDeadManState(READING_TIME, now);
    expect(state.stale).toBe(false);
    expect(state.daysSinceNewestReading).toBe(10);
  });

  it("one second past the 10-day boundary -> stale", () => {
    const now = daysLater(READING_TIME, DEAD_MAN_THRESHOLD_DAYS);
    const oneSecondPast = new Date(Date.parse(now) + 1000).toISOString();
    const state = computeDeadManState(READING_TIME, oneSecondPast);
    expect(state.stale).toBe(true);
  });

  it("just under the boundary (9.99 days) -> not stale", () => {
    const now = daysLater(READING_TIME, 9.99);
    expect(computeDeadManState(READING_TIME, now).stale).toBe(false);
  });

  it("well past the boundary (30 days) -> stale, with the correct day count", () => {
    const now = daysLater(READING_TIME, 30);
    const state = computeDeadManState(READING_TIME, now);
    expect(state.stale).toBe(true);
    expect(state.daysSinceNewestReading).toBe(30);
  });
});

describe("newestReadingTimestamp", () => {
  it("undefined for an empty list", () => {
    expect(newestReadingTimestamp([])).toBeUndefined();
  });

  it("the max finishedAt across readings, regardless of input order", () => {
    const readings = [
      { finishedAt: "2026-08-01T00:00:00.000Z" },
      { finishedAt: "2026-08-10T00:00:00.000Z" },
      { finishedAt: "2026-08-05T00:00:00.000Z" },
    ];
    expect(newestReadingTimestamp(readings)).toBe("2026-08-10T00:00:00.000Z");
  });

  it("a single reading returns its own timestamp", () => {
    expect(newestReadingTimestamp([{ finishedAt: "2026-08-01T00:00:00.000Z" }])).toBe("2026-08-01T00:00:00.000Z");
  });
});
