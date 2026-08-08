/**
 * Calibration gates (SPEC §12, §14 M3): "the numbers that go in the
 * README." Pure, seeded, offline, $0 — no `FakeModelClient`/`runSuite`
 * involved; these sims exercise `core/stats.ts` + `core/compare.ts`'s
 * `classifyBootstrap` directly (SPEC §5 places this gate under
 * "Statistics", i.e. it calibrates the classifier, not the run pipeline).
 * `scripts/calibration-report.mjs --check` (the CI drift gate) asserts the
 * numbers committed in `evals/calibration/results/latest.json` and injected
 * into the README match what this file computes right now — see that
 * script for the sluice `chaos-report.mjs`-mirrored mechanics.
 */
import { describe, expect, it } from "vitest";
import {
  DETECTION_POWER_GATE_MIN_RATE,
  FALSE_POSITIVE_GATE_MAX_FIRES,
  runNullPairCalibration,
  runPlantedDegradationCalibration,
} from "tiltmeter";

describe("calibration: null-pair false-positive rate (SPEC §12)", () => {
  it("fires at most 8/200 (nominal target <=5%) on 200 null pairs drawn from identical per-item rates", () => {
    const result = runNullPairCalibration();
    expect(result.trials).toBe(200);
    expect(result.fires).toBeLessThanOrEqual(FALSE_POSITIVE_GATE_MAX_FIRES);
    expect(result.rate).toBeLessThanOrEqual(0.05);
  });

  it("is deterministic — two independent runs produce byte-identical results", () => {
    const a = runNullPairCalibration();
    const b = runNullPairCalibration();
    expect(a).toEqual(b);
  });
});

describe("calibration: planted-degradation detection power (SPEC §12)", () => {
  it("detects >=90% of 200 pairs with a planted 20% (8-of-40-item) degradation", () => {
    const result = runPlantedDegradationCalibration();
    expect(result.trials).toBe(200);
    expect(result.rate).toBeGreaterThanOrEqual(DETECTION_POWER_GATE_MIN_RATE);
  });

  it("is deterministic — two independent runs produce byte-identical results", () => {
    const a = runPlantedDegradationCalibration();
    const b = runPlantedDegradationCalibration();
    expect(a).toEqual(b);
  });
});
