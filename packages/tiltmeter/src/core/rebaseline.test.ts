import { describe, expect, it } from "vitest";
import { assertRebaselined, hasRebaselineRunGroup, isStale, staleReadings } from "./rebaseline.js";
import { isTiltmeterError } from "./errors.js";
import type { Reading, ReadingAxes } from "./reading.js";

const AXES: ReadingAxes = {
  suiteSpecHash: "hash-v1",
  modelIdRequested: "model-a",
  modelIdResolved: "model-a",
  aliasUsed: false,
  runnerBehaviorVersion: 1,
  presentationHash: "hash-presentation",
  samplingPolicyHash: "hash-sampling",
};

function reading(overrides: Partial<Reading> = {}): Reading {
  return {
    formatVersion: 1,
    runGroupId: "rg-1",
    suiteId: "suite-a",
    cellId: "cell-a",
    axes: AXES,
    harnessCommit: "0000000000000000000000000000000000000",
    runnerVersion: "1.0.0-rc.1",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:00:01.000Z",
    status: "complete",
    completeness: { expectedTrials: 0, ok: 0, error: 0, noResult: 0 },
    metrics: {},
    items: [],
    bodyHash: "sha256:deadbeef",
    ...overrides,
  };
}

describe("isStale", () => {
  it("is false when the reading's suiteSpecHash matches the current one", () => {
    expect(isStale("hash-v1", reading())).toBe(false);
  });

  it("is true once the suite has moved to a new hash", () => {
    expect(isStale("hash-v2", reading())).toBe(true);
  });
});

describe("staleReadings / hasRebaselineRunGroup", () => {
  it("finds stale readings scoped to one suite, ignoring other suites and non-stale readings", () => {
    const readings = [
      reading({ suiteId: "suite-a", axes: { ...AXES, suiteSpecHash: "hash-v1" } }),
      reading({ suiteId: "suite-a", cellId: "cell-b", axes: { ...AXES, suiteSpecHash: "hash-v1" } }),
      reading({ suiteId: "suite-b", axes: { ...AXES, suiteSpecHash: "hash-v1" } }), // different suite, ignored
    ];
    const stale = staleReadings("hash-v2", "suite-a", readings);
    expect(stale).toHaveLength(2);
    expect(stale.every((r) => r.suiteId === "suite-a")).toBe(true);
  });

  it("hasRebaselineRunGroup is false until a complete reading lands under the current hash", () => {
    const readings = [reading({ suiteId: "suite-a", axes: { ...AXES, suiteSpecHash: "hash-v1" } })];
    expect(hasRebaselineRunGroup("hash-v2", "suite-a", readings)).toBe(false);

    const rebaselined = [
      ...readings,
      reading({ suiteId: "suite-a", cellId: "cell-b", axes: { ...AXES, suiteSpecHash: "hash-v2" } }),
    ];
    expect(hasRebaselineRunGroup("hash-v2", "suite-a", rebaselined)).toBe(true);
  });

  it("a partial or aborted reading under the new hash does not count as a rebaseline run group", () => {
    const readings = [
      reading({ suiteId: "suite-a", axes: { ...AXES, suiteSpecHash: "hash-v2" }, status: "partial" }),
    ];
    expect(hasRebaselineRunGroup("hash-v2", "suite-a", readings)).toBe(false);
  });
});

describe("assertRebaselined", () => {
  it("passes silently when neither reading is stale", () => {
    const a = reading({ cellId: "a" });
    const b = reading({ cellId: "b" });
    expect(() => {
      assertRebaselined("hash-v1", "suite-a", [a, b], a, b);
    }).not.toThrow();
  });

  it("throws E_AXIS_CONFLICT when a reading is stale and no rebaseline run group has landed", () => {
    const stale = reading({ cellId: "a", axes: { ...AXES, suiteSpecHash: "hash-v1" } });
    const other = reading({ cellId: "b", axes: { ...AXES, suiteSpecHash: "hash-v1" } });
    let thrown: unknown;
    try {
      assertRebaselined("hash-v2", "suite-a", [stale, other], stale, other);
    } catch (error) {
      thrown = error;
    }
    expect(isTiltmeterError(thrown)).toBe(true);
    if (isTiltmeterError(thrown)) expect(thrown.code).toBe("E_AXIS_CONFLICT");
  });

  it("passes once a rebaseline run group under the current hash exists, even if the compared reading is still stale", () => {
    const stale = reading({ cellId: "a", axes: { ...AXES, suiteSpecHash: "hash-v1" } });
    const rebaselineProof = reading({ cellId: "proof", axes: { ...AXES, suiteSpecHash: "hash-v2" } });
    const currentCell = reading({ cellId: "current", axes: { ...AXES, suiteSpecHash: "hash-v2" } });
    expect(() => {
      assertRebaselined("hash-v2", "suite-a", [stale, rebaselineProof, currentCell], stale, currentCell);
    }).not.toThrow();
  });

  it("ignores readings from a different suite entirely", () => {
    const stale = reading({ suiteId: "suite-other", cellId: "a", axes: { ...AXES, suiteSpecHash: "hash-v1" } });
    const current = reading({ suiteId: "suite-a", cellId: "b", axes: { ...AXES, suiteSpecHash: "hash-v2" } });
    expect(() => {
      assertRebaselined("hash-v2", "suite-a", [stale, current], stale, current);
    }).not.toThrow();
  });
});
