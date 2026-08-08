import { describe, expect, it } from "vitest";
import { buildFixtureSuite } from "../testing/fixtures.js";
import { activeItems, meetsNegativesQuota, parseSuite, suiteSpecHash, SuiteSchema } from "./suite.js";

describe("suiteSpecHash", () => {
  it("is stable for the same suite content", () => {
    const suite = buildFixtureSuite({ positiveCount: 5, negativeCount: 3 });
    expect(suiteSpecHash(suite)).toBe(suiteSpecHash(structuredClone(suite)));
  });

  it("excludes `docs` — editing docs does not change the hash (SPEC §3.1 Decision 3)", () => {
    const suite = buildFixtureSuite({ positiveCount: 5, negativeCount: 3 });
    const withDifferentDocs = { ...suite, docs: "totally different prose" };
    expect(suiteSpecHash(withDifferentDocs)).toBe(suiteSpecHash(suite));
  });

  it("changes when an item is added, retired, or an artifact changes", () => {
    const base = buildFixtureSuite({ positiveCount: 5, negativeCount: 3 });
    const baseHash = suiteSpecHash(base);
    const [firstItem] = base.items;
    if (firstItem === undefined) throw new Error("fixture suite has no items");

    const added = { ...base, items: [...base.items, firstItem] };
    expect(suiteSpecHash(added)).not.toBe(baseHash);

    const retired = {
      ...base,
      items: base.items.map((item, i) =>
        i === 0 ? { ...item, retired: { at: "2026-09-01", reason: "test" } } : item,
      ),
    };
    expect(suiteSpecHash(retired)).not.toBe(baseHash);

    const changedSampling = { ...base, sampling: { ...base.sampling, k: base.sampling.k + 1 } };
    expect(suiteSpecHash(changedSampling)).not.toBe(baseHash);
  });
});

describe("parseSuite", () => {
  it("round-trips a valid fixture suite through Zod", () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 2 });
    const parsed = parseSuite(JSON.parse(JSON.stringify(suite)) as unknown);
    expect(parsed).toEqual(suite);
  });

  it("rejects a suite missing required fields", () => {
    expect(() => SuiteSchema.parse({ formatVersion: 1 })).toThrow();
  });

  it("rejects an artifact with no provenance origin (SPEC §3.1 Decision 1)", () => {
    const suite = buildFixtureSuite({ positiveCount: 1, negativeCount: 3 });
    const bad = {
      ...suite,
      artifacts: [{ id: "x", kind: "skill-description", materialized: { name: "x", description: "x" } }],
    };
    expect(() => SuiteSchema.parse(bad)).toThrow();
  });
});

describe("activeItems / meetsNegativesQuota", () => {
  it("excludes retired items", () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 2 });
    const withRetired = {
      ...suite,
      items: suite.items.map((item, i) =>
        i === 0 ? { ...item, retired: { at: "2026-09-01", reason: "gone" } } : item,
      ),
    };
    expect(activeItems(withRetired)).toHaveLength(suite.items.length - 1);
  });

  it("negatives >= max(3, 20% of active items)", () => {
    // 10 positive + 3 negative = 13 active; 20% of 13 = 2.6 -> ceil 3; max(3,3) = 3. Exactly meets.
    const exact = buildFixtureSuite({ positiveCount: 10, negativeCount: 3 });
    expect(meetsNegativesQuota(exact)).toBe(true);

    // 20 positive + 3 negative = 23 active; 20% of 23 = 4.6 -> ceil 5; 3 < 5, fails.
    const short = buildFixtureSuite({ positiveCount: 20, negativeCount: 3 });
    expect(meetsNegativesQuota(short)).toBe(false);

    // Below the flat floor of 3 even with a tiny suite.
    const tiny = buildFixtureSuite({ positiveCount: 2, negativeCount: 2 });
    expect(meetsNegativesQuota(tiny)).toBe(false);
  });
});
