import { describe, expect, it } from "vitest";
import { isTiltmeterError } from "./errors.js";
import {
  assertWithinCaps,
  capBreachAfterCell,
  checkCaps,
  DEFAULT_CAPS,
  monthToDateUsd,
  type Caps,
} from "./caps.js";

const CAPS: Caps = { maxRunUsd: 3.0, maxCellUsd: 1.5, maxMonthUsd: 15.0 };

describe("DEFAULT_CAPS (SPEC §8)", () => {
  it("matches the spec's numbers exactly", () => {
    expect(DEFAULT_CAPS).toEqual({ maxRunUsd: 3.0, maxCellUsd: 1.5, maxMonthUsd: 15.0 });
  });
});

describe("checkCaps (plan-time, against ESTIMATES)", () => {
  it("ok when every cell, the run total, and the projected month total are all within cap", () => {
    const result = checkCaps({ caps: CAPS, monthToDateUsd: 0, cellEstimatesUsd: [0.36, 0.36, 0.73] });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.runTotalUsd).toBeCloseTo(1.45, 5);
  });

  it("flags a single cell over maxCellUsd", () => {
    const result = checkCaps({ caps: CAPS, monthToDateUsd: 0, cellEstimatesUsd: [2.0] });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([{ kind: "cell", limitUsd: 1.5, wouldBeUsd: 2.0, cellIndex: 0 }]);
  });

  it("flags the run total over maxRunUsd even when every individual cell is within maxCellUsd", () => {
    const result = checkCaps({ caps: CAPS, monthToDateUsd: 0, cellEstimatesUsd: [1.2, 1.2, 1.2] });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === "run")).toBe(true);
  });

  it("flags the projected month total over maxMonthUsd even when the run itself is small", () => {
    const result = checkCaps({ caps: CAPS, monthToDateUsd: 14.5, cellEstimatesUsd: [1.0] });
    expect(result.ok).toBe(false);
    const monthViolation = result.violations.find((v) => v.kind === "month");
    expect(monthViolation?.wouldBeUsd).toBeCloseTo(15.5, 5);
  });

  it("can report multiple simultaneous violations", () => {
    const result = checkCaps({ caps: CAPS, monthToDateUsd: 14, cellEstimatesUsd: [2.0, 2.0] });
    expect(result.violations.map((v) => v.kind).sort()).toEqual(["cell", "cell", "month", "run"]);
  });
});

describe("assertWithinCaps (SPEC §8: plan refuses to emit an over-cap plan)", () => {
  it("is a no-op on a clean result", () => {
    const result = checkCaps({ caps: CAPS, monthToDateUsd: 0, cellEstimatesUsd: [0.36] });
    expect(() => { assertWithinCaps(result); }).not.toThrow();
  });

  it("throws E_CAP naming every violation on a breach", () => {
    const result = checkCaps({ caps: CAPS, monthToDateUsd: 0, cellEstimatesUsd: [5.0] });
    try {
      assertWithinCaps(result);
      throw new Error("expected assertWithinCaps to throw");
    } catch (error) {
      expect(isTiltmeterError(error)).toBe(true);
      if (isTiltmeterError(error)) {
        expect(error.code).toBe("E_CAP");
        expect(error.message).toContain("cell");
        expect(error.message).toContain("run");
      }
    }
  });
});

describe("capBreachAfterCell (run-time, against ACTUALS — SPEC §8)", () => {
  it("undefined (no breach) when the run stays comfortably under every cap", () => {
    const breach = capBreachAfterCell({ caps: CAPS, monthToDateUsd: 0, runSoFarUsd: 0.36 }, 0.73);
    expect(breach).toBeUndefined();
  });

  it("a single cell's ACTUAL cost exceeding maxCellUsd trips immediately", () => {
    const breach = capBreachAfterCell({ caps: CAPS, monthToDateUsd: 0, runSoFarUsd: 0 }, 1.6);
    expect(breach).toEqual({ kind: "cell", limitUsd: 1.5, wouldBeUsd: 1.6 });
  });

  it("cumulative run spend exceeding maxRunUsd trips even though this cell alone is small", () => {
    const breach = capBreachAfterCell({ caps: CAPS, monthToDateUsd: 0, runSoFarUsd: 2.9 }, 0.5);
    expect(breach?.kind).toBe("run");
    expect(breach?.wouldBeUsd).toBeCloseTo(3.4, 5);
  });

  it("committed month-to-date pushing the total over maxMonthUsd trips even on a small run", () => {
    const breach = capBreachAfterCell({ caps: CAPS, monthToDateUsd: 14.8, runSoFarUsd: 0 }, 0.5);
    expect(breach?.kind).toBe("month");
  });
});

describe("monthToDateUsd (SPEC §8: committed, never estimated)", () => {
  it("sums only entries whose `at` falls in the given month", () => {
    const chain = [
      { at: "2026-08-01T00:00:00.000Z", costUsd: 1.45 },
      { at: "2026-08-08T00:00:00.000Z", costUsd: 1.45 },
      { at: "2026-07-25T00:00:00.000Z", costUsd: 9.0 },
      { at: "2026-09-01T00:00:00.000Z", costUsd: 1.0 },
    ];
    expect(monthToDateUsd(chain, "2026-08")).toBeCloseTo(2.9, 5);
  });

  it("zero for a month with no entries", () => {
    expect(monthToDateUsd([{ at: "2026-08-01T00:00:00.000Z", costUsd: 1.0 }], "2026-05")).toBe(0);
  });
});
