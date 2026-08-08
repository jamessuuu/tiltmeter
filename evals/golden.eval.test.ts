/**
 * Classifier goldens (SPEC §12: "≥24 cases, 100% exact-match required").
 * M1 lands the first two — the walking-skeleton gate from SPEC §14:
 * "A planted regression in a fixture pair classifies `regressed`;
 * identical pair classifies `moved-within-noise`." Offline, $0,
 * `FakeModelClient` only. M2 adds the axis/attribution edge cases; M3
 * adds the calibration sims (a separate file, `calibration.eval.test.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  compareReadings,
  presentationHash,
  RUNNER_BEHAVIOR_VERSION,
  runSuite,
  samplingPolicyHash,
  suiteSpecHash,
  TILTMETER_VERSION,
  type RunContext,
  type Suite,
} from "tiltmeter";
import {
  allPassBehavior,
  buildFixtureSuite,
  FakeModelClient,
  FIXTURE_PRESENTATION,
  flippedBehavior,
  scriptForBehavior,
} from "tiltmeter/testing";

const CLOCK = () => "2026-08-08T00:00:00.000Z";

function ctxFor(suite: Suite, runGroupId: string, cellId: string): RunContext {
  return {
    runGroupId,
    cellId,
    suiteSpecHash: suiteSpecHash(suite),
    presentationHash: presentationHash(FIXTURE_PRESENTATION),
    samplingPolicyHash: samplingPolicyHash(suite.sampling),
    runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
    modelIdRequested: "fake-model-1",
    harnessCommit: "fixture0000000000000000000000000000000",
    runnerVersion: TILTMETER_VERSION,
    now: CLOCK,
  };
}

describe("golden: walking skeleton classifier (SPEC §12 positive/negative, §14 M1 gate)", () => {
  it("positive — 12 of 40 items flipped k/k -> 0/k classifies regressed", async () => {
    const suite = buildFixtureSuite({ id: "golden-positive", positiveCount: 30, negativeCount: 10, k: 3 });
    const flippedIds = suite.items.slice(0, 12).map((i) => i.id);

    const baseline = new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) });
    const regressed = new FakeModelClient({ script: scriptForBehavior(suite, flippedBehavior(flippedIds)) });

    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, baseline, ctxFor(suite, "rg-1", "a"));
    const readingB = await runSuite(suite, FIXTURE_PRESENTATION, regressed, ctxFor(suite, "rg-1", "b"));

    const comparison = compareReadings(readingA, readingB);
    expect(comparison.verdict).toBe("regressed");

    const overall = comparison.metrics.find((m) => m.metric === "overall");
    expect(overall?.verdict).toBe("regressed");
    expect(overall?.delta).toBeCloseTo(-12 / 40, 10);
  });

  it("negative — byte-identical readings, different run group, must not fire (moved-within-noise)", async () => {
    const suite = buildFixtureSuite({ id: "golden-negative", positiveCount: 30, negativeCount: 10, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());

    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script }),
      ctxFor(suite, "rg-1", "a"),
    );
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script }),
      ctxFor(suite, "rg-2", "a"),
    );

    const comparison = compareReadings(readingA, readingB);
    expect(comparison.verdict).toBe("moved-within-noise");
    for (const metric of comparison.metrics) {
      expect(metric.delta).toBe(0);
    }
  });
});
