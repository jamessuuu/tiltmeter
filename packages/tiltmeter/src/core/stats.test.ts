import { describe, expect, it } from "vitest";
import { mulberry32 } from "./prng.js";
import { pairedPercentileBootstrap, type ItemPair } from "./stats.js";

describe("pairedPercentileBootstrap", () => {
  it("observed equals mean(b) - mean(a) over the real (non-resampled) pairs", () => {
    const pairs: ItemPair[] = [
      { a: 1, b: 1 },
      { a: 1, b: 0 },
      { a: 1, b: 0 },
      { a: 0, b: 0 },
    ];
    const result = pairedPercentileBootstrap(pairs, mulberry32(1));
    expect(result.observed).toBeCloseTo(0.25 - 0.75, 10); // mean(b)=0.25, mean(a)=0.75
  });

  it("returns the degenerate zero result for an empty pool", () => {
    const result = pairedPercentileBootstrap([], mulberry32(1));
    expect(result).toEqual({ observed: 0, ciLow: 0, ciHigh: 0, b: 10_000 });
  });

  it("is deterministic for a given seed — two independent rng instances give byte-identical results", () => {
    const pairs: ItemPair[] = Array.from({ length: 40 }, (_, i) => ({ a: 1, b: i < 12 ? 0 : 1 }));
    const r1 = pairedPercentileBootstrap(pairs, mulberry32(42));
    const r2 = pairedPercentileBootstrap(pairs, mulberry32(42));
    expect(r1).toEqual(r2);
  });

  it("the observed point estimate never depends on the seed — only the resampled CI can", () => {
    const pairs: ItemPair[] = Array.from({ length: 40 }, (_, i) => ({ a: 1, b: i < 12 ? 0 : 1 }));
    const r1 = pairedPercentileBootstrap(pairs, mulberry32(1));
    const r2 = pairedPercentileBootstrap(pairs, mulberry32(2));
    expect(r1.observed).toBe(r2.observed); // same data -> same point estimate regardless of seed
    expect(r1.ciLow).toBeLessThanOrEqual(r1.ciHigh);
    expect(r2.ciLow).toBeLessThanOrEqual(r2.ciHigh);
  });

  it("respects a custom B (number of resamples)", () => {
    const pairs: ItemPair[] = [{ a: 1, b: 0 }];
    const result = pairedPercentileBootstrap(pairs, mulberry32(1), 500);
    expect(result.b).toBe(500);
  });

  it("a uniform, noise-free effect (every pair identically a=1,b=0) produces a degenerate CI at the observed value", () => {
    const pairs: ItemPair[] = Array.from({ length: 20 }, () => ({ a: 1, b: 0 }));
    const result = pairedPercentileBootstrap(pairs, mulberry32(7));
    expect(result.observed).toBe(-1);
    expect(result.ciLow).toBe(-1);
    expect(result.ciHigh).toBe(-1);
  });

  it("the CI brackets the observed value for a realistic mixed pool", () => {
    const pairs: ItemPair[] = [
      ...Array.from({ length: 30 }, () => ({ a: 1, b: 1 })), // held
      ...Array.from({ length: 10 }, () => ({ a: 1, b: 0 })), // broke
    ];
    const result = pairedPercentileBootstrap(pairs, mulberry32(99));
    expect(result.ciLow).toBeLessThanOrEqual(result.observed);
    expect(result.ciHigh).toBeGreaterThanOrEqual(result.observed);
  });

  it("a zero-effect pool (a === b everywhere) has a CI that includes zero", () => {
    const pairs: ItemPair[] = Array.from({ length: 40 }, (_, i) => ({ a: i % 2, b: i % 2 }));
    const result = pairedPercentileBootstrap(pairs, mulberry32(3));
    expect(result.observed).toBe(0);
    expect(result.ciLow).toBeLessThanOrEqual(0);
    expect(result.ciHigh).toBeGreaterThanOrEqual(0);
  });
});
