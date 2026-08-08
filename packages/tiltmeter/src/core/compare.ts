/**
 * `compare` (SPEC §4 attribution model, §5 statistics, §14 M1-M3).
 *
 * M1 shipped a per-metric mean delta against a minimum-detectable-effect
 * threshold — no axis-attribution gate, no confidence interval. M2 added
 * the attribution gate: SPEC §4 "a comparison is computed only when
 * exactly one axis element differs… anything else -> cannot-attribute,
 * emitted as a first-class verdict with reasons[] naming every axis element
 * that co-varied" — plus the two SPEC §9 completeness rules (a missing
 * cell, or either reading not `status: "complete"`, is also
 * cannot-attribute), SPEC §4's alias-substitution event, and the per-item
 * held/broke/fixed/flaky labels (SPEC §5) with flaky-exclusion from the
 * per-metric item pool. M3 (this file) swaps the classification rule for
 * the seeded paired percentile bootstrap (`core/stats.ts`) over that exact
 * same per-item pool — additive, not a rewrite: `pairsForMetric` is
 * unchanged from M2, only what happens to its output changes.
 */
import { mulberry32, seedFromHex8 } from "./prng.js";
import { sha256Hex } from "./sha256.js";
import { pairedPercentileBootstrap } from "./stats.js";
import { AXIS_TUPLE_KEYS, axisTupleOf, type ItemReading, type Reading } from "./reading.js";

export type MetricVerdict = "regressed" | "improved" | "moved-within-noise";
export type Verdict = MetricVerdict | "cannot-attribute";

/**
 * SPEC §4 "three legal axes" (model/time/harness) plus two structural cases
 * the table doesn't name but the axis-tuple rule still covers: `null-pair`
 * (SPEC §4's mandatory negative control — zero axis elements differ, same
 * run group) and `other` (a lone diff on `runnerBehaviorVersion` /
 * `presentationHash` / `samplingPolicyHash` — legal by the exactly-one-axis
 * rule but not one of the three named, everyday cases). `none` is the
 * cannot-attribute case: there is no axis to report because the comparison
 * itself is refused.
 */
export type ComparisonAxis = "model" | "time" | "harness" | "null-pair" | "other" | "none";

export type ItemLabel = "held" | "broke" | "fixed" | "flaky";

/**
 * SPEC §5: per-item labels are "descriptive, not inferential" — held/broke/
 * fixed describe a clean (k/k or 0/k) transition; flaky means either
 * reading's own k trials were mixed. `aFraction`/`bFraction` are the item's
 * raw pass fraction (`passes/k`) on each side, independent of any metric.
 */
export interface ItemComparison {
  id: string;
  aFraction: number;
  bFraction: number;
  label: ItemLabel;
}

export interface MetricDelta {
  metric: string;
  meanA: number;
  meanB: number;
  delta: number;
  mde: number;
  /** Non-flaky common items this metric's delta was computed over (SPEC §5: MDE default is "1/n"). */
  n: number;
  /** 95% CI lower/upper bound from the seeded paired percentile bootstrap (SPEC §5, B resamples over `n` items). */
  ciLow: number;
  ciHigh: number;
  /** Resample count (SPEC §5 default: 10,000). */
  bootstrapB: number;
  verdict: MetricVerdict;
}

export interface Comparison {
  verdict: Verdict;
  /** Which of SPEC §4's axes this comparison sits on. `"none"` when `verdict === "cannot-attribute"`. */
  axis: ComparisonAxis;
  /**
   * SPEC §4: "reasons[] naming every axis element that co-varied." Empty
   * when attributable. For a >1-axis conflict this is the sorted list of
   * differing `AxisTupleKey` names (e.g. `["modelIdResolved","suiteSpecHash"]`
   * — the director's edge case, SPEC §12). For the other cannot-attribute
   * cases it is a single-element array naming that reason (`["incomplete"]`,
   * `["missing-cell"]`, `["provider-substitution"]`) — the SPEC's own
   * `cannot-attribute(reason)` notation, made literal.
   */
  reasons: string[];
  /** Empty when `verdict === "cannot-attribute"` — SPEC §12: "no delta number is emitted at all." */
  metrics: MetricDelta[];
  /** Empty when `verdict === "cannot-attribute"`. */
  items: ItemComparison[];
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

/** M1/M2's classification rule (mean delta vs MDE only, no CI). Kept and exported for the calibration harness and anything that wants the pre-bootstrap rule directly; `compareReadings` itself now calls `classifyBootstrap`. */
export function classify(metric: string, delta: number, mde: number): MetricVerdict {
  if (Math.abs(delta) < mde) return "moved-within-noise";
  const directional = LOWER_IS_BETTER_METRICS.has(metric) ? -delta : delta;
  return directional < 0 ? "regressed" : "improved";
}

/**
 * SPEC §5's verdict table: `regressed`/`improved` require BOTH the 95% CI
 * to exclude 0 AND `|D| >= MDE`; otherwise `moved-within-noise`. This is
 * strictly more conservative than `classify` (mean-delta-vs-MDE alone) —
 * a large but noisy delta whose CI still straddles 0 no longer fires.
 */
export function classifyBootstrap(
  metric: string,
  observed: number,
  ciLow: number,
  ciHigh: number,
  mde: number,
): MetricVerdict {
  const ciExcludesZero = ciLow > 0 || ciHigh < 0;
  if (!ciExcludesZero || Math.abs(observed) < mde) return "moved-within-noise";
  const directional = LOWER_IS_BETTER_METRICS.has(metric) ? -observed : observed;
  return directional < 0 ? "regressed" : "improved";
}

function cannotAttribute(reasons: string[]): Comparison {
  return { verdict: "cannot-attribute", axis: "none", reasons, metrics: [], items: [] };
}

function isClean(ir: ItemReading): boolean {
  const fraction = ir.k > 0 ? ir.passes / ir.k : 0;
  return fraction === 0 || fraction === 1;
}

function fractionOf(ir: ItemReading): number {
  return ir.k > 0 ? ir.passes / ir.k : 0;
}

/** SPEC §5: broke is a clean k/k -> 0/k transition; fixed the reverse; flaky is "mixed within EITHER reading"; held is everything else clean (unaffected, either still passing or still failing). */
function labelItem(a: ItemReading, b: ItemReading): ItemLabel {
  if (!isClean(a) || !isClean(b)) return "flaky";
  const aFraction = fractionOf(a);
  const bFraction = fractionOf(b);
  if (aFraction === 1 && bFraction === 0) return "broke";
  if (aFraction === 0 && bFraction === 1) return "fixed";
  return "held";
}

/** Items common to both readings (by id), each labeled. Order follows `a.items`. */
export function buildItemComparisons(a: Reading, b: Reading): ItemComparison[] {
  const bById = new Map(b.items.map((ir) => [ir.id, ir]));
  const out: ItemComparison[] = [];
  for (const ai of a.items) {
    const bi = bById.get(ai.id);
    if (bi === undefined) continue;
    out.push({ id: ai.id, aFraction: fractionOf(ai), bFraction: fractionOf(bi), label: labelItem(ai, bi) });
  }
  return out;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Build the (a,b) pass-fraction pairs one declared metric bootstraps over
 * (SPEC §5): all non-flaky common items for `overall`, positives only for
 * `triggerRate`, negatives only (contribution `1 - fraction`) for
 * `falsePositiveRate`. Flaky items (SPEC §5: "mixed within either reading")
 * are excluded here — this is the one place that rule is enforced, so both
 * M2's mean-delta classifier and M3's bootstrap share it unchanged.
 */
export function pairsForMetric(
  metric: string,
  a: Reading,
  b: Reading,
  items: ItemComparison[],
): { a: number; b: number }[] {
  const aById = new Map(a.items.map((ir) => [ir.id, ir]));
  const bById = new Map(b.items.map((ir) => [ir.id, ir]));
  const pairs: { a: number; b: number }[] = [];
  for (const item of items) {
    if (item.label === "flaky") continue;
    const ai = aById.get(item.id);
    const bi = bById.get(item.id);
    if (ai === undefined || bi === undefined) continue; // defensive: items[] is already the common set
    switch (metric) {
      case "overall":
        pairs.push({ a: item.aFraction, b: item.bFraction });
        break;
      case "triggerRate":
        if (ai.polarity === "positive") pairs.push({ a: item.aFraction, b: item.bFraction });
        break;
      case "falsePositiveRate":
        if (ai.polarity === "negative") pairs.push({ a: 1 - item.aFraction, b: 1 - item.bFraction });
        break;
      default:
        break; // an unrecognized declared metric name never reaches here (see compareReadings' metricNames filter)
    }
  }
  return pairs;
}

/** SPEC §4: does resolving the SAME requested (aliased) model to a different snapshot id between two run groups explain the sole `modelIdResolved` diff — a provider-substitution event, not a deliberate model-axis comparison. */
function isProviderSubstitution(a: Reading, b: Reading): boolean {
  return (
    a.runGroupId !== b.runGroupId &&
    a.axes.modelIdRequested === b.axes.modelIdRequested &&
    a.axes.aliasUsed &&
    b.axes.aliasUsed
  );
}

function classifyAxis(a: Reading, b: Reading): { axis: ComparisonAxis } | { cannotAttribute: string[] } {
  const diffKeys = AXIS_TUPLE_KEYS.filter((key) => axisTupleOf(a.axes)[key] !== axisTupleOf(b.axes)[key]);
  if (diffKeys.length > 1) {
    return { cannotAttribute: [...diffKeys].sort() };
  }
  if (diffKeys.length === 0) {
    return { axis: a.runGroupId === b.runGroupId ? "null-pair" : "time" };
  }
  const [key] = diffKeys;
  if (key === undefined) return { axis: "other" }; // unreachable: diffKeys.length === 1 here, guarded above
  if (key === "modelIdResolved") {
    if (isProviderSubstitution(a, b)) return { cannotAttribute: ["provider-substitution"] };
    return { axis: "model" };
  }
  if (key === "suiteSpecHash") return { axis: "harness" };
  return { axis: "other" };
}

/**
 * Compare two readings (SPEC §4 attribution gate + §5 per-metric delta).
 * `a`/`b` may be `undefined` to represent a missing cell (SPEC §5 verdict
 * table: "missing cell" is itself a cannot-attribute reason) — the CLI/report
 * layer that resolves a requested cell to a reading (or nothing) can pass
 * either straight through without a separate branch.
 *
 * Order matters: `delta = mean(b) - mean(a)`, and the bootstrap seed
 * derives from `bodyHashA + bodyHashB` in that same order (SPEC §5: "seed
 * = first 8 hex of sha256(bodyHashA+bodyHashB) — deterministic,
 * reproducible, and not chosen by the analyst") — swapping argument order
 * flips the sign of every result and reseeds the resampling, both expected
 * (SPEC §5's `D` is defined directionally, not as an absolute distance).
 *
 * One seed, one continuing `Rng` stream, consumed across every declared
 * metric IN THE SAME ORDER every time (`Object.keys(a.metrics)`, which
 * follows the suite's declared `metrics` order) — not a fresh `mulberry32`
 * per metric, which would make every metric resample the identical index
 * sequence. Still fully deterministic and reproducible from the two
 * readings' `bodyHash`es alone.
 */
export function compareReadings(a: Reading | undefined, b: Reading | undefined): Comparison {
  if (a === undefined || b === undefined) return cannotAttribute(["missing-cell"]);
  // SPEC §9: "excluded from every aggregate comparison -> cannot-attribute(incomplete)."
  if (a.status !== "complete" || b.status !== "complete") return cannotAttribute(["incomplete"]);

  const axisResult = classifyAxis(a, b);
  if ("cannotAttribute" in axisResult) return cannotAttribute(axisResult.cannotAttribute);
  const { axis } = axisResult;

  const items = buildItemComparisons(a, b);
  const metricNames = Object.keys(a.metrics).filter((m) => m in b.metrics);
  const rng = mulberry32(seedFromHex8(sha256Hex(a.bodyHash + b.bodyHash)));

  const metrics: MetricDelta[] = metricNames.map((metric) => {
    const pairs = pairsForMetric(metric, a, b, items);
    const n = pairs.length;
    const meanA = mean(pairs.map((p) => p.a));
    const meanB = mean(pairs.map((p) => p.b));
    const mde = n > 0 ? 1 / n : 1;
    const { observed: delta, ciLow, ciHigh, b: bootstrapB } = pairedPercentileBootstrap(pairs, rng);
    const verdict = classifyBootstrap(metric, delta, ciLow, ciHigh, mde);
    return { metric, meanA, meanB, delta, mde, n, ciLow, ciHigh, bootstrapB, verdict };
  });

  const verdict: Verdict =
    metrics.length === 0 ? "moved-within-noise" : worstMetricVerdict(metrics.map((m) => m.verdict));

  return { verdict, axis, reasons: [], metrics, items };
}
