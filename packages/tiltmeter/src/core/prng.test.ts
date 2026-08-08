import { describe, expect, it } from "vitest";
import { bernoulliTrial, mulberry32, randomIndex, seedFromHex8, shuffleInPlace } from "./prng.js";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const rng = mulberry32(123456789);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seedFromHex8", () => {
  it("reads the first 8 hex chars as an unsigned 32-bit int", () => {
    expect(seedFromHex8("00000000")).toBe(0);
    expect(seedFromHex8("ffffffff")).toBe(0xffffffff);
    expect(seedFromHex8("deadbeef")).toBe(0xdeadbeef);
  });

  it("ignores hex characters beyond the first 8", () => {
    expect(seedFromHex8("deadbeef" + "cafe")).toBe(0xdeadbeef);
  });
});

describe("shuffleInPlace", () => {
  it("is a permutation of the input (same multiset)", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffleInPlace([...arr], mulberry32(7));
    expect([...shuffled].sort((a, b) => a - b)).toEqual(arr);
  });

  it("is deterministic for a given seed", () => {
    const a = shuffleInPlace([1, 2, 3, 4, 5], mulberry32(99));
    const b = shuffleInPlace([1, 2, 3, 4, 5], mulberry32(99));
    expect(a).toEqual(b);
  });
});

describe("randomIndex", () => {
  it("stays within [0, length)", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const idx = randomIndex(rng, 7);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(7);
    }
  });
});

describe("bernoulliTrial", () => {
  it("always false for p=0 and always true for p=1", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 200; i++) expect(bernoulliTrial(rng, 0)).toBe(false);
    for (let i = 0; i < 200; i++) expect(bernoulliTrial(rng, 1)).toBe(true);
  });

  it("is deterministic for a given seed", () => {
    const a = mulberry32(13);
    const b = mulberry32(13);
    const seqA = Array.from({ length: 50 }, () => bernoulliTrial(a, 0.5));
    const seqB = Array.from({ length: 50 }, () => bernoulliTrial(b, 0.5));
    expect(seqA).toEqual(seqB);
  });

  it("lands close to p over many draws", () => {
    const rng = mulberry32(17);
    let trues = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (bernoulliTrial(rng, 0.3)) trues++;
    expect(trues / n).toBeGreaterThan(0.28);
    expect(trues / n).toBeLessThan(0.32);
  });
});
