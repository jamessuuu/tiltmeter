/**
 * Classifier goldens (SPEC §12: "≥24 cases, 100% exact-match required").
 * M1 lands the first two — the walking-skeleton gate from SPEC §14:
 * "A planted regression in a fixture pair classifies `regressed`;
 * identical pair classifies `moved-within-noise`." Offline, $0,
 * `FakeModelClient` only. M2 adds the axis/attribution edge cases (this
 * file, below); M3 adds the calibration sims (a separate file,
 * `calibration.eval.test.ts`).
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
  type ModelTrialResponse,
  type RunContext,
  type Suite,
  type TrialResult,
} from "tiltmeter";
import {
  allPassBehavior,
  buildFixtureSuite,
  FakeModelClient,
  FIXTURE_PRESENTATION,
  flippedBehavior,
  noResultTrial,
  noToolTrial,
  scriptForBehavior,
  type FakeScript,
} from "tiltmeter/testing";

const CLOCK = () => "2026-08-08T00:00:00.000Z";

function ctxFor(suite: Suite, runGroupId: string, cellId: string, overrides: Partial<RunContext> = {}): RunContext {
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
    ...overrides,
  };
}

/** Patch every scripted `ok` trial's `modelIdResolved` — simulates an alias resolving to a specific dated snapshot (SPEC §4). */
function withResolvedModel(script: FakeScript, modelIdResolved: string): FakeScript {
  const patched: FakeScript = {};
  for (const [itemId, perAttempt] of Object.entries(script)) {
    if (perAttempt === undefined) continue;
    const next: Record<number, TrialResult> = {};
    for (const [attempt, trial] of Object.entries(perAttempt)) {
      const response: ModelTrialResponse | undefined = trial.outcome === "ok" ? trial.response : undefined;
      next[Number(attempt)] =
        trial.outcome === "ok" && response !== undefined
          ? { outcome: "ok", response: { ...response, modelIdResolved } }
          : trial;
    }
    patched[itemId] = next;
  }
  return patched;
}

/** Force one item's one attempt to fail — a wobble that makes a `k=3` item non-clean (`2/3`) without touching the other `k-1` attempts. */
function withFailedAttempt(script: FakeScript, itemId: string, attempt: number): FakeScript {
  const perAttempt = script[itemId];
  if (perAttempt === undefined) throw new Error(`withFailedAttempt: no scripted trials for item "${itemId}"`);
  return { ...script, [itemId]: { ...perAttempt, [attempt]: noToolTrial() } };
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

  it("negative (near-miss) — a single item's partial wobble is flaky, excluded, and leaves the verdict at moved-within-noise (false-positive discipline)", async () => {
    const suite = buildFixtureSuite({ id: "golden-near-miss", positiveCount: 30, negativeCount: 10, k: 3 });
    const [wobbleItem] = suite.items;
    if (wobbleItem === undefined) throw new Error("fixture suite has no items");

    const script = withFailedAttempt(scriptForBehavior(suite, allPassBehavior()), wobbleItem.id, 1);
    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "a"));
    const readingB = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "b"));

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.verdict).toBe("moved-within-noise");
    expect(cmp.items.find((i) => i.id === wobbleItem.id)?.label).toBe("flaky");
    for (const metric of cmp.metrics) expect(metric.delta).toBe(0);
  });
});

describe("golden: attribution edge cases (SPEC §12 edge goldens, §14 M2 gate)", () => {
  it("edge (director's case) — suite edited AND model changed together ⇒ cannot-attribute, reasons exactly [modelIdResolved, suiteSpecHash], no delta emitted", async () => {
    const suiteBase = buildFixtureSuite({ id: "golden-edge-director", positiveCount: 25, negativeCount: 15, k: 3 });
    // One extra negative item = a genuine suite edit (SPEC §3.1 Decision 2: suites grow only by retirement/addition, never in-place edit).
    const suiteEdited = buildFixtureSuite({ id: "golden-edge-director", positiveCount: 25, negativeCount: 16, k: 3 });
    expect(suiteSpecHash(suiteEdited)).not.toBe(suiteSpecHash(suiteBase));

    const clientA = new FakeModelClient({
      script: withResolvedModel(scriptForBehavior(suiteBase, allPassBehavior()), "model-x-resolved"),
    });
    const clientB = new FakeModelClient({
      script: withResolvedModel(scriptForBehavior(suiteEdited, allPassBehavior()), "model-y-resolved"),
    });

    const readingA = await runSuite(
      suiteBase,
      FIXTURE_PRESENTATION,
      clientA,
      ctxFor(suiteBase, "rg-1", "a", { modelIdRequested: "model-x" }),
    );
    const readingB = await runSuite(
      suiteEdited,
      FIXTURE_PRESENTATION,
      clientB,
      ctxFor(suiteEdited, "rg-1", "b", { modelIdRequested: "model-y" }),
    );

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["modelIdResolved", "suiteSpecHash"]);
    expect(cmp.metrics).toEqual([]);
  });

  it("edge — a partial reading (3 noResult) is excluded from every aggregate ⇒ cannot-attribute(incomplete)", async () => {
    const suite = buildFixtureSuite({ id: "golden-edge-partial", positiveCount: 20, negativeCount: 10, k: 3 });
    const complete = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) }),
      ctxFor(suite, "rg-1", "a"),
    );

    let partialScript = scriptForBehavior(suite, allPassBehavior());
    for (const item of suite.items.slice(0, 3)) {
      const perAttempt = partialScript[item.id];
      if (perAttempt === undefined) throw new Error(`missing script for item "${item.id}"`);
      partialScript = { ...partialScript, [item.id]: { ...perAttempt, 1: noResultTrial("simulated 529") } };
    }
    const partial = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: partialScript }),
      ctxFor(suite, "rg-1", "b"),
    );
    expect(partial.status).toBe("partial");
    expect(partial.completeness.noResult).toBe(3);

    const cmp = compareReadings(complete, partial);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["incomplete"]);
  });

  it("edge — flaky items (2/3 both sides) are excluded from D and listed as flaky; verdict unchanged", async () => {
    const suite = buildFixtureSuite({ id: "golden-edge-flaky", positiveCount: 30, negativeCount: 10, k: 3 });
    const flippedIds = suite.items.slice(0, 12).map((i) => i.id);
    const [flakyItem] = suite.items.slice(12, 13);
    if (flakyItem === undefined) throw new Error("fixture suite has no items");

    const scriptA = scriptForBehavior(suite, allPassBehavior());
    const scriptB = scriptForBehavior(suite, flippedBehavior(flippedIds));
    const baselineA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: scriptA }), ctxFor(suite, "rg-1", "a"));
    const baselineB = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: scriptB }), ctxFor(suite, "rg-1", "b"));
    const baseline = compareReadings(baselineA, baselineB);

    const flakyScriptA = withFailedAttempt(scriptA, flakyItem.id, 1);
    const flakyScriptB = withFailedAttempt(scriptB, flakyItem.id, 1);
    const flakyA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: flakyScriptA }), ctxFor(suite, "rg-1", "a"));
    const flakyB = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: flakyScriptB }), ctxFor(suite, "rg-1", "b"));
    const cmp = compareReadings(flakyA, flakyB);

    expect(cmp.items.find((i) => i.id === flakyItem.id)?.label).toBe("flaky");
    expect(cmp.verdict).toBe(baseline.verdict); // "verdict unchanged" (SPEC §12) — still regressed, flaky item didn't flip it
    const overall = cmp.metrics.find((m) => m.metric === "overall");
    const baseOverall = baseline.metrics.find((m) => m.metric === "overall");
    // The flaky item is excluded from D entirely — not just left at its old value — so `n` drops by
    // exactly one (40 -> 39) and the mean shifts accordingly (-12/40 -> -12/39): still comfortably
    // "regressed" (SPEC §5's bar), the point this golden exists to prove.
    expect(overall?.n).toBe((baseOverall?.n ?? 0) - 1);
    expect(overall?.delta).toBeCloseTo(-12 / 39, 10);
  });

  it("edge — an alias resolving to a different snapshot id between run groups ⇒ cannot-attribute(provider-substitution)", async () => {
    const suite = buildFixtureSuite({ id: "golden-edge-alias", positiveCount: 20, negativeCount: 10, k: 3 });
    const scriptA = withResolvedModel(scriptForBehavior(suite, allPassBehavior()), "claude-sonnet-5-20260801");
    const scriptB = withResolvedModel(scriptForBehavior(suite, allPassBehavior()), "claude-sonnet-5-20260901");

    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptA }),
      ctxFor(suite, "rg-1", "a", { modelIdRequested: "claude-sonnet-5" }),
    );
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptB }),
      ctxFor(suite, "rg-2", "a", { modelIdRequested: "claude-sonnet-5" }),
    );
    expect(readingA.axes.aliasUsed).toBe(true);
    expect(readingB.axes.aliasUsed).toBe(true);

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["provider-substitution"]);
  });

  it("edge — same axes, different run group ⇒ classified on the time axis (provider-side drift, not attribution)", async () => {
    const suite = buildFixtureSuite({ id: "golden-edge-time", positiveCount: 20, negativeCount: 10, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());

    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "a"));
    const readingB = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-2", "a"));

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.axis).toBe("time");
    expect(cmp.verdict).toBe("moved-within-noise");
  });
});

describe("golden: additional classifier coverage (SPEC §12: >=24 total, M3)", () => {
  it("improved — 12 positive items fixed AND 3 negative items stop misfiring ⇒ every declared metric improves", async () => {
    // A suite's verdict is the WORST of its declared metrics (SPEC §5), and moved-within-noise
    // outranks improved in that ranking — so getting suite-level "improved" requires EVERY
    // declared metric to genuinely improve, not just `overall`. Flipping only positive items
    // leaves falsePositiveRate flat (moved-within-noise), which would win the worst-of and sink
    // the suite verdict to noise even though overall/triggerRate improved. Flip some negatives
    // too so falsePositiveRate has a real (improving) delta of its own.
    // negativeCount is larger than the other goldens' here (20, not 10): with only 3 signal
    // items out of 10 negatives the bootstrap CI on falsePositiveRate was too wide (n too small
    // for the resample to reliably exclude 0) — 6 of 20 keeps the same ~30% signal ratio the
    // "positive"/"regressed" goldens use, at an n the bootstrap can actually resolve.
    const suite = buildFixtureSuite({ id: "golden-improved", positiveCount: 30, negativeCount: 20, k: 3 });
    const positives = suite.items.filter((i) => i.polarity === "positive");
    const negatives = suite.items.filter((i) => i.polarity === "negative");
    const brokenInA = [...positives.slice(0, 12).map((i) => i.id), ...negatives.slice(0, 6).map((i) => i.id)];

    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, flippedBehavior(brokenInA)) }),
      ctxFor(suite, "rg-1", "a"),
    );
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) }),
      ctxFor(suite, "rg-1", "b"),
    );

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.metrics.find((m) => m.metric === "overall")?.verdict).toBe("improved");
    expect(cmp.metrics.find((m) => m.metric === "triggerRate")?.verdict).toBe("improved");
    expect(cmp.metrics.find((m) => m.metric === "falsePositiveRate")?.verdict).toBe("improved");
    expect(cmp.verdict).toBe("improved");
  });

  it("FPR-only regression — overall/triggerRate flat, negatives newly misfire ⇒ suite verdict regressed", async () => {
    const suite = buildFixtureSuite({ id: "golden-fpr-only", positiveCount: 20, negativeCount: 20, k: 3 });
    const negativeIds = suite.items.filter((i) => i.polarity === "negative").map((i) => i.id);

    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) }),
      ctxFor(suite, "rg-1", "a"),
    );
    // Only negatives misfire in b; every positive still passes -> triggerRate unaffected.
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, flippedBehavior(negativeIds)) }),
      ctxFor(suite, "rg-1", "b"),
    );

    const cmp = compareReadings(readingA, readingB);
    const triggerRate = cmp.metrics.find((m) => m.metric === "triggerRate");
    const fpr = cmp.metrics.find((m) => m.metric === "falsePositiveRate");
    expect(triggerRate?.verdict).toBe("moved-within-noise");
    expect(fpr?.verdict).toBe("regressed");
    expect(cmp.verdict).toBe("regressed"); // worst-of
  });

  it("axis: harness — a suite edit alone (same model) is the rebaseline pair, computed normally", async () => {
    const suiteBase = buildFixtureSuite({ id: "golden-axis-harness", positiveCount: 20, negativeCount: 10, k: 3 });
    const suiteEdited = buildFixtureSuite({ id: "golden-axis-harness", positiveCount: 20, negativeCount: 11, k: 3 });

    const readingA = await runSuite(
      suiteBase,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suiteBase, allPassBehavior()) }),
      ctxFor(suiteBase, "rg-1", "a"),
    );
    const readingB = await runSuite(
      suiteEdited,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suiteEdited, allPassBehavior()) }),
      ctxFor(suiteEdited, "rg-2", "a"),
    );

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.axis).toBe("harness");
    expect(cmp.verdict).not.toBe("cannot-attribute");
  });

  it("axis: model — two different (non-aliased) models within the same run group is the deliberate panel comparison", async () => {
    const suite = buildFixtureSuite({ id: "golden-axis-model", positiveCount: 20, negativeCount: 10, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());

    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: withResolvedModel(script, "haiku-resolved") }),
      ctxFor(suite, "rg-1", "haiku", { modelIdRequested: "haiku" }),
    );
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: withResolvedModel(script, "sonnet-resolved") }),
      ctxFor(suite, "rg-1", "sonnet", { modelIdRequested: "sonnet" }),
    );

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.axis).toBe("model");
    expect(cmp.verdict).toBe("moved-within-noise"); // identical behavior, only the model identity differs
  });

  it("a lone diff on presentationHash alone is attributable (axis 'other', not one of the three named axes)", async () => {
    const suite = buildFixtureSuite({ id: "golden-axis-other-presentation", positiveCount: 15, negativeCount: 5, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());
    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "a"));
    const readingB = { ...readingA, cellId: "b", axes: { ...readingA.axes, presentationHash: "different-presentation-hash" } };

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.axis).toBe("other");
    expect(cmp.verdict).not.toBe("cannot-attribute");
  });

  it("a lone diff on samplingPolicyHash alone is attributable (axis 'other')", async () => {
    const suite = buildFixtureSuite({ id: "golden-axis-other-sampling", positiveCount: 15, negativeCount: 5, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());
    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "a"));
    const readingB = { ...readingA, cellId: "b", axes: { ...readingA.axes, samplingPolicyHash: "different-sampling-hash" } };

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.axis).toBe("other");
    expect(cmp.verdict).not.toBe("cannot-attribute");
  });

  it("a lone diff on runnerBehaviorVersion alone is attributable (axis 'other')", async () => {
    const suite = buildFixtureSuite({ id: "golden-axis-other-runner", positiveCount: 15, negativeCount: 5, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());
    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "a"));
    const readingB = { ...readingA, cellId: "b", axes: { ...readingA.axes, runnerBehaviorVersion: readingA.axes.runnerBehaviorVersion + 1 } };

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.axis).toBe("other");
    expect(cmp.verdict).not.toBe("cannot-attribute");
  });

  it("two co-varying axis elements OTHER than the director's combo also refuse attribution, reasons sorted", async () => {
    const suite = buildFixtureSuite({ id: "golden-axis-conflict-other", positiveCount: 15, negativeCount: 5, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());
    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "a"));
    const readingB = {
      ...readingA,
      cellId: "b",
      axes: { ...readingA.axes, presentationHash: "different-presentation-hash", samplingPolicyHash: "different-sampling-hash" },
    };

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["presentationHash", "samplingPolicyHash"]);
    expect(cmp.metrics).toEqual([]);
  });

  it("missing cell — the 'a' side absent", async () => {
    const suite = buildFixtureSuite({ id: "golden-missing-a", positiveCount: 10, negativeCount: 5, k: 3 });
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) }),
      ctxFor(suite, "rg-1", "b"),
    );
    const cmp = compareReadings(undefined, readingB);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["missing-cell"]);
  });

  it("missing cell — the 'b' side absent", async () => {
    const suite = buildFixtureSuite({ id: "golden-missing-b", positiveCount: 10, negativeCount: 5, k: 3 });
    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) }),
      ctxFor(suite, "rg-1", "a"),
    );
    const cmp = compareReadings(readingA, undefined);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["missing-cell"]);
  });

  it("incomplete on the 'a' side (not just 'b') is symmetric ⇒ cannot-attribute(incomplete)", async () => {
    const suite = buildFixtureSuite({ id: "golden-incomplete-a", positiveCount: 15, negativeCount: 5, k: 3 });
    let partialScript = scriptForBehavior(suite, allPassBehavior());
    const [firstItem] = suite.items;
    if (firstItem === undefined) throw new Error("fixture suite has no items");
    const perAttempt = partialScript[firstItem.id];
    if (perAttempt === undefined) throw new Error("missing script");
    partialScript = { ...partialScript, [firstItem.id]: { ...perAttempt, 1: noResultTrial("simulated 429") } };

    const partial = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: partialScript }), ctxFor(suite, "rg-1", "a"));
    const complete = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) }),
      ctxFor(suite, "rg-1", "b"),
    );

    const cmp = compareReadings(partial, complete);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["incomplete"]);
  });

  it("multiple flaky items are all excluded together; the verdict reflects only the remaining clean items", async () => {
    const suite = buildFixtureSuite({ id: "golden-multi-flaky", positiveCount: 30, negativeCount: 10, k: 3 });
    const flippedIds = suite.items.slice(0, 12).map((i) => i.id);
    const flakyIds = suite.items.slice(12, 15).map((i) => i.id); // 3 flaky items

    let scriptA = scriptForBehavior(suite, allPassBehavior());
    let scriptB = scriptForBehavior(suite, flippedBehavior(flippedIds));
    for (const id of flakyIds) {
      scriptA = withFailedAttempt(scriptA, id, 1);
      scriptB = withFailedAttempt(scriptB, id, 1);
    }

    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: scriptA }), ctxFor(suite, "rg-1", "a"));
    const readingB = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: scriptB }), ctxFor(suite, "rg-1", "b"));
    const cmp = compareReadings(readingA, readingB);

    for (const id of flakyIds) {
      expect(cmp.items.find((i) => i.id === id)?.label).toBe("flaky");
    }
    const overall = cmp.metrics.find((m) => m.metric === "overall");
    expect(overall?.n).toBe(40 - flakyIds.length);
    expect(cmp.verdict).toBe("regressed");
  });

  it("mixed broke+fixed items nearly cancel out ⇒ moved-within-noise, but both labels still appear in the item list", async () => {
    const suite = buildFixtureSuite({ id: "golden-broke-and-fixed", positiveCount: 20, negativeCount: 10, k: 3 });
    const brokeIds = suite.items.slice(0, 3).map((i) => i.id);
    const fixedIds = suite.items.slice(3, 6).map((i) => i.id);

    // a: brokeIds pass, fixedIds fail. b: brokeIds fail, fixedIds pass. Net delta ~= 0.
    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, flippedBehavior(fixedIds)) }),
      ctxFor(suite, "rg-1", "a"),
    );
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, flippedBehavior(brokeIds)) }),
      ctxFor(suite, "rg-1", "b"),
    );

    const cmp = compareReadings(readingA, readingB);
    for (const id of brokeIds) expect(cmp.items.find((i) => i.id === id)?.label).toBe("broke");
    for (const id of fixedIds) expect(cmp.items.find((i) => i.id === id)?.label).toBe("fixed");
    expect(cmp.verdict).toBe("moved-within-noise");
  });

  it("both triggerRate and falsePositiveRate regress simultaneously ⇒ suite verdict regressed", async () => {
    const suite = buildFixtureSuite({ id: "golden-both-regress", positiveCount: 20, negativeCount: 20, k: 3 });
    const positiveIds = suite.items.filter((i) => i.polarity === "positive").map((i) => i.id);
    const negativeIds = suite.items.filter((i) => i.polarity === "negative").map((i) => i.id);

    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) }),
      ctxFor(suite, "rg-1", "a"),
    );
    const degraded = scriptForBehavior(suite, flippedBehavior([...positiveIds, ...negativeIds]));
    const readingB = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: degraded }), ctxFor(suite, "rg-1", "b"));

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.metrics.find((m) => m.metric === "triggerRate")?.verdict).toBe("regressed");
    expect(cmp.metrics.find((m) => m.metric === "falsePositiveRate")?.verdict).toBe("regressed");
    expect(cmp.verdict).toBe("regressed");
  });

  it("opposing metrics — triggerRate improves while falsePositiveRate regresses ⇒ suite verdict is the worst (regressed)", async () => {
    const suite = buildFixtureSuite({ id: "golden-opposing", positiveCount: 20, negativeCount: 20, k: 3 });
    const positiveIds = suite.items.filter((i) => i.polarity === "positive").map((i) => i.id);
    const negativeIds = suite.items.filter((i) => i.polarity === "negative").map((i) => i.id);

    // a: positives fail, negatives correctly silent. b: positives pass (improved), negatives now misfire (regressed).
    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, flippedBehavior(positiveIds)) }),
      ctxFor(suite, "rg-1", "a"),
    );
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, flippedBehavior(negativeIds)) }),
      ctxFor(suite, "rg-1", "b"),
    );

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.metrics.find((m) => m.metric === "triggerRate")?.verdict).toBe("improved");
    expect(cmp.metrics.find((m) => m.metric === "falsePositiveRate")?.verdict).toBe("regressed");
    expect(cmp.verdict).toBe("regressed"); // worst-of: regressed outranks improved
  });

  it("a realistic launch-scale suite (~108 items) with a small planted regression still classifies regressed", async () => {
    const suite = buildFixtureSuite({ id: "golden-launch-scale", positiveCount: 70, negativeCount: 38, k: 3 });
    const brokeIds = suite.items.slice(0, 6).map((i) => i.id); // ~5.6% of items, a realistic small regression

    const readingA = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) }),
      ctxFor(suite, "rg-1", "a"),
    );
    const readingB = await runSuite(
      suite,
      FIXTURE_PRESENTATION,
      new FakeModelClient({ script: scriptForBehavior(suite, flippedBehavior(brokeIds)) }),
      ctxFor(suite, "rg-1", "b"),
    );

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.verdict).toBe("regressed");
    expect(cmp.metrics.find((m) => m.metric === "overall")?.n).toBe(108);
  });

  it("a flaky item on the 'a' side only is still excluded (mixed within EITHER reading, symmetric with the 'b'-only case)", async () => {
    const suite = buildFixtureSuite({ id: "golden-flaky-a-only", positiveCount: 20, negativeCount: 10, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());
    const [flakyItem] = suite.items;
    if (flakyItem === undefined) throw new Error("fixture suite has no items");
    const flakyScript = withFailedAttempt(script, flakyItem.id, 1);

    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script: flakyScript }), ctxFor(suite, "rg-1", "a"));
    const readingB = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "b"));

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.items.find((i) => i.id === flakyItem.id)?.label).toBe("flaky");
    expect(cmp.metrics.find((m) => m.metric === "overall")?.n).toBe(29);
  });

  it("a clean rerun at larger scale (identical suite/model, different run group) stays moved-within-noise", async () => {
    const suite = buildFixtureSuite({ id: "golden-large-clean-rerun", positiveCount: 60, negativeCount: 20, k: 3 });
    const script = scriptForBehavior(suite, allPassBehavior());

    const readingA = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-1", "a"));
    const readingB = await runSuite(suite, FIXTURE_PRESENTATION, new FakeModelClient({ script }), ctxFor(suite, "rg-2", "a"));

    const cmp = compareReadings(readingA, readingB);
    expect(cmp.axis).toBe("time");
    expect(cmp.verdict).toBe("moved-within-noise");
    for (const metric of cmp.metrics) expect(metric.delta).toBe(0);
  });
});
