/**
 * Rebaseline detection (SPEC §4: "When `suiteSpecHash` changes, `tiltmeter
 * plan` marks every existing model cell for that suite as stale and
 * schedules a rebaseline run group that re-runs the whole panel on the new
 * hash. Until that run group exists, `compare` refuses to cross the
 * boundary.").
 *
 * `compareReadings` (`./compare.js`) itself stays a pure two-reading
 * function — given exactly two readings whose axis tuples differ only in
 * `suiteSpecHash`, computing that delta IS the rebaseline-pair comparison
 * the harness axis exists for (SPEC §4's table: "harness … did my edit
 * change behavior (rebaseline pair)"). What this module guards is the
 * ORCHESTRATION question `compareReadings` cannot answer on its own because
 * it never sees the suite file or the full readings corpus: given the
 * suite's CURRENT `suiteSpecHash`, is a particular reading stale, and has a
 * rebaseline run group actually landed yet for that suite? A CLI/report
 * layer resolving "the current reading for model X" should call
 * `assertRebaselined` before treating a stale reading as current.
 */
import { TiltmeterError } from "./errors.js";
import type { Reading } from "./reading.js";

/** A reading is stale once the suite it was run against has moved to a different `suiteSpecHash` (SPEC §4). */
export function isStale(currentSuiteSpecHash: string, reading: Pick<Reading, "axes">): boolean {
  return reading.axes.suiteSpecHash !== currentSuiteSpecHash;
}

/** Every reading, for one suite, whose `suiteSpecHash` no longer matches the suite's current hash. */
export function staleReadings(
  currentSuiteSpecHash: string,
  suiteId: string,
  readings: readonly Reading[],
): Reading[] {
  return readings.filter((r) => r.suiteId === suiteId && isStale(currentSuiteSpecHash, r));
}

/**
 * A rebaseline run group "exists" for a suite once at least one COMPLETE
 * reading has landed under the suite's current hash (SPEC §4: re-running
 * "the whole panel" is a `plan`/M4 scheduling concern; this module only
 * asserts the minimal, checkable fact — that the boundary has been crossed
 * for real at least once — which is what makes further comparisons under
 * the new hash legitimate).
 */
export function hasRebaselineRunGroup(
  currentSuiteSpecHash: string,
  suiteId: string,
  readings: readonly Reading[],
): boolean {
  return readings.some(
    (r) => r.suiteId === suiteId && r.status === "complete" && r.axes.suiteSpecHash === currentSuiteSpecHash,
  );
}

/**
 * Throws `TiltmeterError("E_AXIS_CONFLICT")` if either `a` or `b` is a
 * stale reading (SPEC §4) for a suite that has not yet completed a
 * rebaseline run group under its current hash. Readings already on the
 * current hash always pass. Call this BEFORE `compareReadings` when the
 * two readings were resolved from "the latest reading for this cell" rather
 * than pinned explicitly — SPEC §4: "compare refuses to cross the boundary
 * until a rebaseline run group exists."
 */
export function assertRebaselined(
  currentSuiteSpecHash: string,
  suiteId: string,
  readings: readonly Reading[],
  a: Reading,
  b: Reading,
): void {
  for (const reading of [a, b]) {
    if (reading.suiteId !== suiteId) continue;
    if (!isStale(currentSuiteSpecHash, reading)) continue;
    if (!hasRebaselineRunGroup(currentSuiteSpecHash, suiteId, readings)) {
      throw new TiltmeterError(
        "E_AXIS_CONFLICT",
        `rebaseline required: suite "${suiteId}" has moved to a new suiteSpecHash and reading ` +
          `"${reading.runGroupId}/${reading.cellId}" is stale, but no rebaseline run group has completed yet.`,
      );
    }
  }
}
