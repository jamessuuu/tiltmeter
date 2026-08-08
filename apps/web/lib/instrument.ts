/**
 * Pure geometry/formatting for `/`'s instrument (SPEC §10): per-suite,
 * per-model series across run groups, with a HARD BREAK annotated at
 * every `suiteSpecHash` change (SPEC §4: "the chart refuses to draw a
 * line across a suite change"). Isolated from React/Next so it is
 * unit-testable without rendering anything.
 */
import type { Reading } from "tiltmeter";

export interface SeriesPoint {
  runGroupId: string;
  cellId: string;
  suiteSpecHash: string;
  modelIdResolved: string;
  startedAt: string;
  status: Reading["status"];
  metrics: Record<string, number>;
  /** True when this point's `suiteSpecHash` differs from the immediately preceding point in the SAME series — SPEC §4/§10: "hard breaks at every suiteSpecHash change (annotated 'suite rebaselined — series restarts')." Always false for the first point (nothing precedes it to break from). */
  hardBreakBefore: boolean;
}

/** One model's (`cellId`'s) readings, oldest first, annotated with hard breaks. */
export function buildSeries(readings: readonly Reading[]): SeriesPoint[] {
  const sorted = [...readings].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const out: SeriesPoint[] = [];
  let previousHash: string | undefined;
  for (const r of sorted) {
    out.push({
      runGroupId: r.runGroupId,
      cellId: r.cellId,
      suiteSpecHash: r.axes.suiteSpecHash,
      modelIdResolved: r.axes.modelIdResolved,
      startedAt: r.startedAt,
      status: r.status,
      metrics: r.metrics,
      hardBreakBefore: previousHash !== undefined && previousHash !== r.axes.suiteSpecHash,
    });
    previousHash = r.axes.suiteSpecHash;
  }
  return out;
}

/** Every `cellId` -> its series, for one suite's readings. */
export function buildSeriesByCellId(readings: readonly Reading[]): Map<string, SeriesPoint[]> {
  const byCellId = new Map<string, Reading[]>();
  for (const r of readings) {
    const arr = byCellId.get(r.cellId) ?? [];
    arr.push(r);
    byCellId.set(r.cellId, arr);
  }
  const out = new Map<string, SeriesPoint[]>();
  for (const [cellId, rs] of byCellId) out.set(cellId, buildSeries(rs));
  return out;
}

/** Short, git-log-style hash for display (SPEC's own headline example: "harness a1b2c3d"). */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/** Percentage-point formatting for a metric delta (SPEC's headline example: "overall −8.2pp"). */
export function formatPercentagePoints(fraction: number): string {
  const pp = fraction * 100;
  const sign = pp > 0 ? "+" : pp < 0 ? "−" : "";
  return `${sign}${Math.abs(pp).toFixed(1)}pp`;
}
