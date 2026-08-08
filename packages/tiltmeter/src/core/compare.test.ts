import { describe, expect, it } from "vitest";
import { compareReadings, worstMetricVerdict } from "./compare.js";
import type { ItemReading, Reading, ReadingAxes } from "./reading.js";
import type { Polarity } from "./suite.js";

const BASE_AXES: ReadingAxes = {
  suiteSpecHash: "hash-suite",
  modelIdRequested: "model-a",
  modelIdResolved: "model-a",
  aliasUsed: false,
  runnerBehaviorVersion: 1,
  presentationHash: "hash-presentation",
  samplingPolicyHash: "hash-sampling",
};

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function fractionOf(ir: ItemReading): number {
  return ir.k > 0 ? ir.passes / ir.k : 0;
}

/** Mirrors `core/run.ts`'s `computeMetrics` formula exactly, so fixture readings' `.metrics` are never independent of their `.items` (an M1 fixture bug: hand-set metrics that didn't match a blanket-full-pass items array, which M3's item-driven delta would have silently ignored). */
function computeExpectedMetric(metric: string, itemReadings: ItemReading[]): number {
  switch (metric) {
    case "overall":
      return mean(itemReadings.map(fractionOf));
    case "triggerRate":
      return mean(itemReadings.filter((i) => i.polarity === "positive").map(fractionOf));
    case "falsePositiveRate":
      return mean(itemReadings.filter((i) => i.polarity === "negative").map((i) => 1 - fractionOf(i)));
    default:
      return 0;
  }
}

interface ItemSpec {
  id: string;
  polarity?: Polarity;
  k?: number;
  aPasses: number;
  bPasses: number;
}

let bodyHashCounter = 0;

function buildReading(
  runGroupId: string,
  cellId: string,
  items: ItemReading[],
  declaredMetrics: string[],
  overrides: Partial<Reading> = {},
): Reading {
  bodyHashCounter += 1;
  const metrics: Record<string, number> = {};
  for (const m of declaredMetrics) metrics[m] = computeExpectedMetric(m, items);
  const totalTrials = items.reduce((sum, i) => sum + i.k, 0);
  return {
    formatVersion: 1,
    runGroupId,
    suiteId: "suite-a",
    cellId,
    axes: BASE_AXES,
    harnessCommit: "0000000000000000000000000000000000000",
    runnerVersion: "0.1.0-alpha.0",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:00:01.000Z",
    status: "complete",
    completeness: { expectedTrials: totalTrials, ok: totalTrials, error: 0, noResult: 0 },
    metrics,
    items,
    bodyHash: `sha256:fixture-${String(bodyHashCounter)}`,
    ...overrides,
  };
}

/** Build an (a,b) reading pair from per-item pass counts — the single source of truth for both `.items` and `.metrics`, so every test exercises the same item-driven delta `compareReadings` actually computes. */
function buildPair(
  specs: ItemSpec[],
  options: {
    declaredMetrics?: string[];
    runGroupIdA?: string;
    runGroupIdB?: string;
    overridesA?: Partial<Reading>;
    overridesB?: Partial<Reading>;
  } = {},
): { a: Reading; b: Reading } {
  const declaredMetrics = options.declaredMetrics ?? ["overall"];
  const aItems: ItemReading[] = specs.map((s) => ({
    id: s.id,
    polarity: s.polarity ?? "positive",
    k: s.k ?? 3,
    passes: s.aPasses,
    trials: [],
  }));
  const bItems: ItemReading[] = specs.map((s) => ({
    id: s.id,
    polarity: s.polarity ?? "positive",
    k: s.k ?? 3,
    passes: s.bPasses,
    trials: [],
  }));
  const a = buildReading(
    options.runGroupIdA ?? "rg-1",
    "a",
    aItems,
    declaredMetrics,
    options.overridesA ?? {},
  );
  const b = buildReading(
    options.runGroupIdB ?? "rg-1",
    "b",
    bItems,
    declaredMetrics,
    options.overridesB ?? {},
  );
  return { a, b };
}

const ITEMS40_ALL_PASS: ItemSpec[] = Array.from({ length: 40 }, (_, i) => ({
  id: `item-${String(i + 1)}`,
  aPasses: 3,
  bPasses: 3,
}));

function flipItems(specs: ItemSpec[], flippedIds: readonly string[]): ItemSpec[] {
  const flipped = new Set(flippedIds);
  return specs.map((s) => (flipped.has(s.id) ? { ...s, bPasses: 0 } : s));
}

describe("compareReadings — bootstrap classification (SPEC §5, M3)", () => {
  it("classifies regressed when the mean delta is negative and beyond MDE", () => {
    const { a, b } = buildPair(flipItems(ITEMS40_ALL_PASS, ITEMS40_ALL_PASS.slice(0, 20).map((i) => i.id)));
    const cmp = compareReadings(a, b);
    expect(cmp.verdict).toBe("regressed");
    expect(cmp.metrics[0]?.delta).toBeCloseTo(-0.5, 10);
  });

  it("classifies improved when the mean delta is positive and beyond MDE", () => {
    const { a, b } = buildPair(flipItems(ITEMS40_ALL_PASS, ITEMS40_ALL_PASS.slice(0, 20).map((i) => i.id)));
    // Swap direction: compare b -> a instead of a -> b.
    const cmp = compareReadings(b, a);
    expect(cmp.verdict).toBe("improved");
  });

  it("classifies moved-within-noise for a zero delta (byte-identical items)", () => {
    const { a, b } = buildPair(ITEMS40_ALL_PASS);
    expect(compareReadings(a, b).verdict).toBe("moved-within-noise");
    for (const m of compareReadings(a, b).metrics) expect(m.delta).toBe(0);
  });

  it("classifies moved-within-noise for a single-item flip — the CI still straddles 0 even though |D| == MDE (false-positive discipline)", () => {
    // MDE = 1/40 for a 40-item suite; a 1-item flip lands delta exactly AT MDE (never
    // below it — a full flip can't be smaller than "one item's worth"). Under M1's
    // mean-delta-only rule this alone was enough to fire "regressed". M3's bootstrap CI
    // is the real false-positive-discipline mechanism SPEC §12's "near-miss" golden
    // describes: with only 1 of 40 items carrying any signal, most resamples don't even
    // draw that item, so the 95% CI still includes 0 and the verdict stays noise.
    const [firstItem] = ITEMS40_ALL_PASS;
    if (firstItem === undefined) throw new Error("fixture has no items");
    const flipped = flipItems(ITEMS40_ALL_PASS, [firstItem.id]);
    const { a: nearA, b: nearB } = buildPair(flipped);
    const cmp = compareReadings(nearA, nearB);
    expect(cmp.metrics[0]?.delta).toBeCloseTo(-1 / 40, 10);
    expect(cmp.metrics[0]?.mde).toBeCloseTo(1 / 40, 10);
    expect(cmp.verdict).toBe("moved-within-noise");
  });

  it("a suite's verdict is the WORST of its declared metrics", () => {
    const specs: ItemSpec[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `pos-${String(i)}`, polarity: "positive" as const, aPasses: 3, bPasses: 3 })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `neg-${String(i)}`, polarity: "negative" as const, aPasses: 3, bPasses: 0 })), // negatives now incorrectly fire in b
    ];
    const { a, b } = buildPair(specs, { declaredMetrics: ["overall", "triggerRate", "falsePositiveRate"] });
    const cmp = compareReadings(a, b);
    expect(cmp.verdict).toBe("regressed");
    const fpr = cmp.metrics.find((m) => m.metric === "falsePositiveRate");
    expect(fpr?.verdict).toBe("regressed");
  });

  it("only compares metrics present on both readings", () => {
    const { a: baseA, b } = buildPair(ITEMS40_ALL_PASS, { declaredMetrics: ["overall"] });
    const a: Reading = { ...baseA, metrics: { ...baseA.metrics, extraOnA: 1 } };
    const cmp = compareReadings(a, b);
    expect(cmp.metrics.map((m) => m.metric)).toEqual(["overall"]);
  });

  it("falls back to moved-within-noise when there are no common metrics", () => {
    const { a: baseA, b: baseB } = buildPair(ITEMS40_ALL_PASS);
    const a: Reading = { ...baseA, metrics: { onlyA: 1 } };
    const b: Reading = { ...baseB, metrics: { onlyB: 1 } };
    expect(compareReadings(a, b).verdict).toBe("moved-within-noise");
  });
});

describe("worstMetricVerdict", () => {
  it("ranks regressed worst, then moved-within-noise, then improved best", () => {
    expect(worstMetricVerdict(["improved", "moved-within-noise", "regressed"])).toBe("regressed");
    expect(worstMetricVerdict(["improved", "moved-within-noise"])).toBe("moved-within-noise");
    expect(worstMetricVerdict(["improved"])).toBe("improved");
    expect(worstMetricVerdict([])).toBe("improved");
  });
});

describe("compareReadings — attribution gate (SPEC §4/§9, M2)", () => {
  it("cannot-attribute(missing-cell) when either reading is absent", () => {
    const { a } = buildPair(ITEMS40_ALL_PASS);
    expect(compareReadings(a, undefined)).toEqual({
      verdict: "cannot-attribute",
      axis: "none",
      reasons: ["missing-cell"],
      metrics: [],
      items: [],
    });
    expect(compareReadings(undefined, a)).toEqual({
      verdict: "cannot-attribute",
      axis: "none",
      reasons: ["missing-cell"],
      metrics: [],
      items: [],
    });
    expect(compareReadings(undefined, undefined).reasons).toEqual(["missing-cell"]);
  });

  it("cannot-attribute(incomplete) when either reading's status is not complete", () => {
    const { a, b } = buildPair(ITEMS40_ALL_PASS, { overridesB: { status: "partial" } });
    const cmp = compareReadings(a, b);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["incomplete"]);
    expect(cmp.metrics).toEqual([]);
  });

  it("cannot-attribute with reasons naming EVERY co-varying axis element — the director's edge case (harness edited AND model changed)", () => {
    const { a, b } = buildPair(ITEMS40_ALL_PASS, {
      overridesB: {
        axes: { ...BASE_AXES, suiteSpecHash: "hash-suite-v2", modelIdResolved: "model-b" },
      },
    });
    const cmp = compareReadings(a, b);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["modelIdResolved", "suiteSpecHash"]);
    expect(cmp.metrics).toEqual([]); // "no delta number is emitted at all"
  });

  it("cannot-attribute(provider-substitution) when an alias resolves to a different snapshot id between run groups", () => {
    const { a, b } = buildPair(ITEMS40_ALL_PASS, {
      runGroupIdB: "rg-2",
      overridesA: { axes: { ...BASE_AXES, modelIdRequested: "claude-sonnet-5", modelIdResolved: "claude-sonnet-5-20260801", aliasUsed: true } },
      overridesB: { axes: { ...BASE_AXES, modelIdRequested: "claude-sonnet-5", modelIdResolved: "claude-sonnet-5-20260901", aliasUsed: true } },
    });
    const cmp = compareReadings(a, b);
    expect(cmp.verdict).toBe("cannot-attribute");
    expect(cmp.reasons).toEqual(["provider-substitution"]);
  });

  it("axis: model — same run group, only modelIdResolved differs (a deliberate panel comparison, not a substitution)", () => {
    const { a, b } = buildPair(ITEMS40_ALL_PASS, {
      overridesA: { axes: { ...BASE_AXES, modelIdRequested: "haiku", modelIdResolved: "haiku-resolved" } },
      overridesB: { axes: { ...BASE_AXES, modelIdRequested: "sonnet", modelIdResolved: "sonnet-resolved" } },
    });
    const cmp = compareReadings(a, b);
    expect(cmp.axis).toBe("model");
    expect(cmp.verdict).not.toBe("cannot-attribute");
  });

  it("axis: harness — only suiteSpecHash differs (the rebaseline pair)", () => {
    const { a, b } = buildPair(ITEMS40_ALL_PASS, {
      overridesB: { axes: { ...BASE_AXES, suiteSpecHash: "hash-suite-v2" } },
    });
    const cmp = compareReadings(a, b);
    expect(cmp.axis).toBe("harness");
    expect(cmp.verdict).not.toBe("cannot-attribute");
  });

  it("axis: time — same axes, different run group, classified as provider-side drift", () => {
    const { a, b } = buildPair(ITEMS40_ALL_PASS, { runGroupIdB: "rg-2" });
    const cmp = compareReadings(a, b);
    expect(cmp.axis).toBe("time");
    expect(cmp.verdict).toBe("moved-within-noise"); // byte-identical items -> zero delta
  });

  it("axis: null-pair — identical axes, same run group (the mandatory negative control)", () => {
    const { a, b } = buildPair(ITEMS40_ALL_PASS); // both default to rg-1
    const cmp = compareReadings(a, b);
    expect(cmp.axis).toBe("null-pair");
  });
});

describe("compareReadings — per-item labels (SPEC §5, M2)", () => {
  it("labels held/broke/fixed and excludes nothing when every item is clean", () => {
    const specs: ItemSpec[] = [
      { id: "still-passing", aPasses: 3, bPasses: 3 },
      { id: "still-failing", aPasses: 0, bPasses: 0 },
      { id: "broke-item", aPasses: 3, bPasses: 0 },
      { id: "fixed-item", aPasses: 0, bPasses: 3 },
    ];
    const { a, b } = buildPair(specs);
    const cmp = compareReadings(a, b);
    const byId = new Map(cmp.items.map((i) => [i.id, i.label]));
    expect(byId.get("still-passing")).toBe("held");
    expect(byId.get("still-failing")).toBe("held");
    expect(byId.get("broke-item")).toBe("broke");
    expect(byId.get("fixed-item")).toBe("fixed");
  });

  it("flaky items (mixed within either reading) are excluded from D and reported separately — verdict unchanged", () => {
    const cleanSpecs: ItemSpec[] = flipItems(ITEMS40_ALL_PASS, ITEMS40_ALL_PASS.slice(0, 12).map((i) => i.id));
    const { a: baseA, b: baseB } = buildPair(cleanSpecs);
    const baseline = compareReadings(baseA, baseB);

    // Same 40 items, plus one extra flaky item (2/3 both sides) spliced in.
    const withFlaky: ItemSpec[] = [...cleanSpecs, { id: "flaky-item", aPasses: 2, bPasses: 2 }];
    const { a: flakyA, b: flakyB } = buildPair(withFlaky);
    const cmp = compareReadings(flakyA, flakyB);

    const flakyEntry = cmp.items.find((i) => i.id === "flaky-item");
    expect(flakyEntry?.label).toBe("flaky");
    expect(cmp.metrics[0]?.delta).toBeCloseTo(baseline.metrics[0]?.delta ?? NaN, 10);
    expect(cmp.metrics[0]?.n).toBe(baseline.metrics[0]?.n); // flaky item excluded from n too
    expect(cmp.verdict).toBe(baseline.verdict);
  });

  it("an item flaky on only ONE side is still excluded (mixed within EITHER reading)", () => {
    const specs: ItemSpec[] = [
      ...ITEMS40_ALL_PASS.slice(0, 39),
      { id: "flaky-on-b-only", aPasses: 3, bPasses: 1 },
    ];
    const { a, b } = buildPair(specs);
    const cmp = compareReadings(a, b);
    const flakyEntry = cmp.items.find((i) => i.id === "flaky-on-b-only");
    expect(flakyEntry?.label).toBe("flaky");
    expect(cmp.metrics[0]?.n).toBe(39);
  });
});
