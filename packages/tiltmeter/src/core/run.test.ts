import { describe, expect, it } from "vitest";
import {
  allPassBehavior,
  buildFixtureSuite,
  FakeModelClient,
  FIXTURE_PRESENTATION,
  noResultTrial,
  scriptForBehavior,
} from "../testing/index.js";
import { presentationHash, samplingPolicyHash } from "./presentation.js";
import { RUNNER_BEHAVIOR_VERSION, TILTMETER_VERSION } from "./version.js";
import { runSuite, type RunContext } from "./run.js";
import { suiteSpecHash } from "./suite.js";

const CLOCK = () => "2026-08-08T00:00:00.000Z";

function baseCtx(suite: ReturnType<typeof buildFixtureSuite>, overrides: Partial<RunContext> = {}): RunContext {
  return {
    runGroupId: "rg-1",
    cellId: "cell-a",
    suiteSpecHash: suiteSpecHash(suite),
    presentationHash: presentationHash(FIXTURE_PRESENTATION),
    samplingPolicyHash: samplingPolicyHash(suite.sampling),
    runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
    modelIdRequested: "fake-model-1",
    harnessCommit: "0000000000000000000000000000000000000",
    runnerVersion: TILTMETER_VERSION,
    now: CLOCK,
    ...overrides,
  };
}

describe("runSuite", () => {
  it("the completeness denominator is always items x k, and a complete run has zero noResult", async () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3, k: 3 });
    const client = new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) });
    const reading = await runSuite(suite, FIXTURE_PRESENTATION, client, baseCtx(suite));

    expect(reading.completeness.expectedTrials).toBe(7 * 3);
    expect(reading.completeness.ok).toBe(7 * 3);
    expect(reading.completeness.noResult).toBe(0);
    expect(reading.status).toBe("complete");
    expect(reading.metrics.overall).toBe(1);
  });

  it("noResult trials are never scored as a fail, and the reading becomes partial", async () => {
    const suite = buildFixtureSuite({ positiveCount: 2, negativeCount: 3, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());
    const [firstItem] = suite.items;
    if (firstItem === undefined) throw new Error("fixture suite has no items");
    const firstItemId = firstItem.id;
    script[firstItemId] = { ...script[firstItemId], 1: noResultTrial("simulated 529") };
    const client = new FakeModelClient({ script });

    const reading = await runSuite(suite, FIXTURE_PRESENTATION, client, baseCtx(suite));

    expect(reading.status).toBe("partial");
    expect(reading.completeness.noResult).toBe(1);
    // Denominator unchanged — the missing trial is not dropped from k.
    expect(reading.completeness.expectedTrials).toBe(5 * 3);
    expect(reading.completeness.ok).toBe(5 * 3 - 1);
    const firstItemReading = reading.items.find((i) => i.id === firstItemId);
    expect(firstItemReading?.k).toBe(3);
    expect(firstItemReading?.trials.find((t) => t.attempt === 1)?.outcome).toBe("noResult");
    // The other two attempts on that item still pass, so passes reflects them, not a forced fail.
    expect(firstItemReading?.passes).toBe(2);
  });

  it("computes overall / triggerRate / falsePositiveRate correctly", async () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 4, k: 1 });
    // Fail every negative item (they incorrectly call a tool) but pass every positive.
    const negIds = new Set(suite.items.filter((i) => i.polarity === "negative").map((i) => i.id));
    const script = scriptForBehavior(suite, (id) => !negIds.has(id));
    const client = new FakeModelClient({ script });

    const reading = await runSuite(suite, FIXTURE_PRESENTATION, client, baseCtx(suite));

    expect(reading.metrics.triggerRate).toBe(1); // all positives passed
    expect(reading.metrics.falsePositiveRate).toBe(1); // all negatives incorrectly fired
    expect(reading.metrics.overall).toBe(0.5); // 4/8 items passed
  });

  it("bodyHash is deterministic for identical inputs and changes when metrics differ", async () => {
    const suite = buildFixtureSuite({ positiveCount: 3, negativeCount: 3, k: 2 });
    const script = scriptForBehavior(suite, allPassBehavior());

    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script }),
      baseCtx(suite, { runGroupId: "rg-x", cellId: "cell-x" }),
    );
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script }),
      baseCtx(suite, { runGroupId: "rg-x", cellId: "cell-x" }),
    );
    expect(readingA.bodyHash).toBe(readingB.bodyHash);
    expect(readingA.bodyHash.startsWith("sha256:")).toBe(true);

    const [firstItem] = suite.items;
    if (firstItem === undefined) throw new Error("fixture suite has no items");
    const flippedScript = scriptForBehavior(suite, (id) => id !== firstItem.id);
    const readingC = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: flippedScript }),
      baseCtx(suite, { runGroupId: "rg-x", cellId: "cell-x" }),
    );
    expect(readingC.bodyHash).not.toBe(readingA.bodyHash);
  });

  it("records axes, and flags aliasUsed when the resolved model id differs from the requested one", async () => {
    const suite = buildFixtureSuite({ positiveCount: 2, negativeCount: 3, k: 1 });
    // Re-script every trial to resolve to a different snapshot id (simulated alias resolution).
    const script = scriptForBehavior(suite, allPassBehavior());
    for (const itemId of Object.keys(script)) {
      const perAttempt = script[itemId];
      if (perAttempt === undefined) continue;
      for (const attempt of Object.keys(perAttempt)) {
        const trial = perAttempt[Number(attempt)];
        if (trial?.outcome === "ok") {
          trial.response.modelIdResolved = "fake-model-1-20260101";
        }
      }
    }
    const aliasClient = new FakeModelClient({ script });

    const reading = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      aliasClient,
      baseCtx(suite, { modelIdRequested: "fake-model-1" }),
    );

    expect(reading.axes.modelIdRequested).toBe("fake-model-1");
    expect(reading.axes.modelIdResolved).toBe("fake-model-1-20260101");
    expect(reading.axes.aliasUsed).toBe(true);
    expect(reading.axes.suiteSpecHash).toBe(suiteSpecHash(suite));
    expect(reading.axes.runnerBehaviorVersion).toBe(RUNNER_BEHAVIOR_VERSION);
  });
});
