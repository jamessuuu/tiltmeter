/**
 * `compare` (SPEC §14 M1: "`compare` emits a verdict (M1: mean delta,
 * bootstrap arrives M3)"). This is the M1 shape only: per-metric mean
 * delta against a minimum-detectable-effect threshold, no confidence
 * interval yet and no axis-attribution gate yet (SPEC §14 M2 adds
 * `cannot-attribute` with `reasons[]`; M3 swaps the classification rule
 * for the seeded paired bootstrap and adds per-item labels). Both
 * extensions are additive to this module, landing in the M2 and M3 commits.
 */
import type { Reading } from "./reading.js";

export type MetricVerdict = "regressed" | "improved" | "moved-within-noise";
export type Verdict = MetricVerdict | "cannot-attribute";

export interface MetricDelta {
  metric: string;
  meanA: number;
  meanB: number;
  delta: number;
  mde: number;
  verdict: MetricVerdict;
}

export interface Comparison {
  verdict: Verdict;
  metrics: MetricDelta[];
}

const METRIC_VERDICT_RANK: Record<MetricVerdict, number> = {
  "improved": 0,
  "moved-within-noise": 1,
  "regressed": 2,
};

/** SPEC §5: "worst" = most concerning first: regressed, then moved-within-noise, then improved. */
export function worstMetricVerdict(verdicts: MetricVerdict[]): MetricVerdict {
  let worst: MetricVerdict = "improved";
  for (const v of verdicts) {
    if (METRIC_VERDICT_RANK[v] > METRIC_VERDICT_RANK[worst]) worst = v;
  }
  return worst;
}

/**
 * `falsePositiveRate` is the one declared metric (SPEC §3.1 example, §11)
 * where lower is better — a rising rate of negatives incorrectly firing is
 * a regression, not an improvement. Every other metric is "higher is
 * better" (a pass fraction). Directionality is looked up by name rather
 * than inferred, since guessing it wrong silently flips a verdict.
 */
const LOWER_IS_BETTER_METRICS: ReadonlySet<string> = new Set(["falsePositiveRate"]);

function classify(metric: string, delta: number, mde: number): MetricVerdict {
  if (Math.abs(delta) < mde) return "moved-within-noise";
  const directional = LOWER_IS_BETTER_METRICS.has(metric) ? -delta : delta;
  return directional < 0 ? "regressed" : "improved";
}

/** Safe lookup for a key already proven present by the caller — throws instead of a non-null assertion. */
function requireMetric(metrics: Record<string, number>, key: string): number {
  const value = metrics[key];
  if (value === undefined) {
    throw new Error(`compare: metric "${key}" unexpectedly missing`);
  }
  return value;
}

/** Item ids common to both readings — items retired between the two are excluded rather than guessed at. */
function commonItemCount(a: Reading, b: Reading): number {
  const idsA = new Set(a.items.map((i) => i.id));
  let n = 0;
  for (const item of b.items) {
    if (idsA.has(item.id)) n++;
  }
  return n;
}

/**
 * Compare two readings' declared metrics. SPEC §5: `D = mean_i(b_i) -
 * mean_i(a_i)` per metric; MDE default `1/n` (one item's worth). Reads
 * `reading.metrics` directly (already computed per-metric means by
 * `core/run`'s `computeMetrics`) rather than recomputing from trials, so
 * `compare` never needs suite context (only two committed readings).
 */
export function compareReadings(a: Reading, b: Reading): Comparison {
  const n = commonItemCount(a, b);
  const mde = n > 0 ? 1 / n : 1;
  const metricNames = Object.keys(a.metrics).filter((m) => m in b.metrics);

  const metrics: MetricDelta[] = metricNames.map((metric) => {
    const meanA = requireMetric(a.metrics, metric);
    const meanB = requireMetric(b.metrics, metric);
    const delta = meanB - meanA;
    return { metric, meanA, meanB, delta, mde, verdict: classify(metric, delta, mde) };
  });

  const verdict: Verdict =
    metrics.length === 0 ? "moved-within-noise" : worstMetricVerdict(metrics.map((m) => m.verdict));

  return { verdict, metrics };
}
