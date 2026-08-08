/**
 * Calibration sims (SPEC §12, §14 M3): "200 null pairs drawn from
 * identical per-item rates ⇒ false-positive rate ≤ 5% (CI fails at
 * >8/200)" and "200 pairs with a planted 20% degradation on 40 items ⇒
 * detected ≥ 90%." These are the numbers that go in the README. Pure and
 * seeded (SPEC §6/§5: no `Math.random`, no ambient clock) — every run of
 * `pnpm calibration` (or the `eval` CI stage) reproduces byte-identical
 * results from the constants below.
 *
 * Design notes (recorded here since the spec's own prose is a one-line
 * summary of a simulation that needs concrete parameters to run):
 *  - Both sims share one item pool: 40 items, each with a shared per-item
 *    "clean" pass rate of 0.9 — high enough to represent a normally-reliable
 *    harness, low enough that the occasional single-trial miss (and the
 *    flaky-exclusion it triggers, SPEC §5) is a real, regularly-occurring
 *    condition the sim actually exercises rather than a theoretical edge
 *    case assumed away with noise-free exact fractions.
 *  - Null-pair sim: BOTH readings draw independently from the SAME
 *    per-item rate — "identical per-item rates" (SPEC §12), i.e. the null
 *    hypothesis that nothing changed. A false positive is any verdict that
 *    is not `moved-within-noise`.
 *  - Planted-degradation sim: 8 of the 40 items (20%, matching SPEC §12's
 *    own "12 of 40" idiom for the positive golden) drop to
 *    `CALIBRATION_DEGRADED_RATE` (0 — a clean, fully-deterministic planted
 *    signal, deliberately) in the second reading; the other 32 keep the
 *    same noisy-but-identical 0.9 rate as the null sim as background noise.
 *    Power is tested against a KNOWN, well-defined effect size on top of
 *    realistic noise elsewhere in the pool — conflating "can the bootstrap
 *    detect this effect" with "how noisy is the effect itself" would test
 *    two different things at once. Detection is any verdict of `regressed`
 *    on the `overall` metric.
 */
import { bernoulliTrial, mulberry32, seedFromHex8, type Rng } from "./prng.js";
import { sha256Hex } from "./sha256.js";
import { classifyBootstrap } from "./compare.js";
import { pairedPercentileBootstrap, type ItemPair } from "./stats.js";

export const CALIBRATION_ITEM_COUNT = 40;
export const CALIBRATION_K = 3;
export const CALIBRATION_TRIALS = 200;
export const CALIBRATION_BOOTSTRAP_B = 10_000;
export const CALIBRATION_BASE_RATE = 0.9;
export const CALIBRATION_DEGRADED_COUNT = 8; // 20% of 40 (SPEC §12)
/** The planted items' pass rate in reading B — 0 (a clean, deterministic signal) so the power gate tests the bootstrap's ability to detect a KNOWN effect size, not a second independent noise source layered on top of it. */
export const CALIBRATION_DEGRADED_RATE = 0;

/** Deterministic base seed for a calibration sim, derived from a fixed name — never `Math.random`, never analyst-chosen per run. */
function baseSeed(name: string): number {
  return seedFromHex8(sha256Hex(`tiltmeter-calibration:${name}:v1`));
}

/** One item's observed pass fraction from `k` independent Bernoulli(rate) draws. */
function observedFraction(rng: Rng, k: number, rate: number): number {
  let passes = 0;
  for (let i = 0; i < k; i++) {
    if (bernoulliTrial(rng, rate)) passes++;
  }
  return passes / k;
}

function isClean(fraction: number): boolean {
  return fraction === 0 || fraction === 1;
}

/**
 * One simulated trial's `overall`-metric verdict: draw `itemCount` pairs
 * (using `rates[i]` for BOTH sides unless `degradedRates` supplies a
 * different rate for reading B), exclude flaky pairs exactly as
 * `core/compare.ts` does, bootstrap, and classify.
 */
function simulateOneTrial(
  rng: Rng,
  rates: readonly number[],
  degradedRatesB: readonly number[] | undefined,
): "regressed" | "improved" | "moved-within-noise" {
  const pairs: ItemPair[] = [];
  for (const [i, rate] of rates.entries()) {
    const a = observedFraction(rng, CALIBRATION_K, rate);
    const b = observedFraction(rng, CALIBRATION_K, degradedRatesB?.[i] ?? rate);
    if (!isClean(a) || !isClean(b)) continue; // flaky — excluded from D (SPEC §5), same rule compare.ts enforces
    pairs.push({ a, b });
  }
  const n = pairs.length;
  const mde = n > 0 ? 1 / n : 1;
  const { observed, ciLow, ciHigh } = pairedPercentileBootstrap(pairs, rng, CALIBRATION_BOOTSTRAP_B);
  return classifyBootstrap("overall", observed, ciLow, ciHigh, mde);
}

export interface CalibrationResult {
  trials: number;
  fires: number;
  rate: number;
}

/**
 * SPEC §12: "200 null pairs drawn from identical per-item rates ⇒
 * false-positive rate ≤ 5% (CI fails at >8/200)." Both readings, every
 * trial, draw from the SAME per-item rate — nothing planted, nothing
 * should fire.
 */
export function runNullPairCalibration(): CalibrationResult {
  const rng = mulberry32(baseSeed("null-pair"));
  const rates = Array.from({ length: CALIBRATION_ITEM_COUNT }, () => CALIBRATION_BASE_RATE);
  let fires = 0;
  for (let t = 0; t < CALIBRATION_TRIALS; t++) {
    const verdict = simulateOneTrial(rng, rates, undefined);
    if (verdict !== "moved-within-noise") fires++;
  }
  return { trials: CALIBRATION_TRIALS, fires, rate: fires / CALIBRATION_TRIALS };
}

/**
 * SPEC §12: "200 pairs with a planted 20% degradation on 40 items ⇒
 * detected ≥ 90%." `CALIBRATION_DEGRADED_COUNT` items drop from the shared
 * baseline rate to `CALIBRATION_DEGRADED_RATE` (a clean, known effect) in
 * reading B; the remaining items keep the same shared noisy 0.9 rate both
 * sides — the same background noise the null-pair sim tests against —
 * so detection has to survive realistic noise EVERYWHERE ELSE in the pool
 * even though the planted signal itself is exact.
 */
export function runPlantedDegradationCalibration(): CalibrationResult {
  const rng = mulberry32(baseSeed("planted-degradation"));
  const rates = Array.from({ length: CALIBRATION_ITEM_COUNT }, () => CALIBRATION_BASE_RATE);
  const degradedRatesB = rates.map((rate, i) => (i < CALIBRATION_DEGRADED_COUNT ? CALIBRATION_DEGRADED_RATE : rate));
  let fires = 0;
  for (let t = 0; t < CALIBRATION_TRIALS; t++) {
    const verdict = simulateOneTrial(rng, rates, degradedRatesB);
    if (verdict === "regressed") fires++;
  }
  return { trials: CALIBRATION_TRIALS, fires, rate: fires / CALIBRATION_TRIALS };
}

export const FALSE_POSITIVE_GATE_MAX_FIRES = 8; // SPEC §12: "CI fails at >8/200"
export const DETECTION_POWER_GATE_MIN_RATE = 0.9; // SPEC §12: "detected >= 90%"
