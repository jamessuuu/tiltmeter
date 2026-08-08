/**
 * The seeded paired percentile bootstrap (SPEC §5, §14 M3): "Resample
 * items (not trials) with replacement; the same item set runs on both
 * sides, so pairing removes item-difficulty variance and gives usable
 * power at n = 30–60." `core/compare.ts` builds the per-item `(a,b)` pairs
 * (already flaky-excluded, already scoped to one metric's item pool —
 * SPEC §5); this module only knows how to resample and summarize them.
 * Pure and isomorphic (SPEC §6): no ambient randomness, an injected `Rng`.
 */
import { randomIndex, type Rng } from "./prng.js";

export interface ItemPair {
  a: number;
  b: number;
}

export interface BootstrapResult {
  /** `mean(b) - mean(a)` over the REAL (non-resampled) pairs — SPEC §5's `D`. */
  observed: number;
  /** 2.5th percentile of the resampled deltas (95% CI lower bound). */
  ciLow: number;
  /** 97.5th percentile of the resampled deltas (95% CI upper bound). */
  ciHigh: number;
  b: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Nearest-rank percentile of an ALREADY-SORTED-ASCENDING array. `p` in `[0,1]`. */
function percentileOfSorted(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  const value = sorted[index];
  if (value === undefined) throw new Error("percentileOfSorted: empty array");
  return value;
}

/**
 * SPEC §5: "seeded paired percentile bootstrap over items, B = 10,000, 95%
 * CI." `pairs` is one metric's (a,b) item pool, already non-flaky and
 * already scoped (positives for `triggerRate`, negatives for
 * `falsePositiveRate` with the `1 - fraction` contribution, all items for
 * `overall` — SPEC §5, `core/compare.ts`'s `pairsForMetric`). Each of the
 * `b` resamples draws `pairs.length` indices WITH replacement (the
 * "resample items" rule — the same drawn index is used for both `a` and
 * `b`, which is what makes this "paired" and removes item-difficulty
 * variance rather than adding new noise from resampling the two sides
 * independently) and records the resampled mean delta; the CI is the
 * 2.5th/97.5th percentile of that distribution.
 */
export function pairedPercentileBootstrap(pairs: readonly ItemPair[], rng: Rng, b = 10_000): BootstrapResult {
  const n = pairs.length;
  if (n === 0) return { observed: 0, ciLow: 0, ciHigh: 0, b };

  const observed = mean(pairs.map((p) => p.b)) - mean(pairs.map((p) => p.a));

  const deltas = new Float64Array(b);
  for (let i = 0; i < b; i++) {
    let sumA = 0;
    let sumB = 0;
    for (let j = 0; j < n; j++) {
      const pair = pairs[randomIndex(rng, n)];
      if (pair === undefined) throw new Error("pairedPercentileBootstrap: index out of range"); // unreachable: randomIndex is bounded to [0,n)
      sumA += pair.a;
      sumB += pair.b;
    }
    deltas[i] = (sumB - sumA) / n;
  }
  const sorted = Array.from(deltas).sort((x, y) => x - y);

  return { observed, ciLow: percentileOfSorted(sorted, 0.025), ciHigh: percentileOfSorted(sorted, 0.975), b };
}
