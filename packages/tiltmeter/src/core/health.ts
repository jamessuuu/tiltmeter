/**
 * The health-check's pure decision (SPEC §8 M7 `health.yml`: "daily; fails
 * loudly and opens an issue if the newest reading is >14 days old"). This
 * is the CI backstop behind the 60-day auto-disable mitigation — a
 * `skipped` index entry keeps the repo committing (never disabled), but a
 * skipped/aborted week is not the same thing as a REAL reading landing, so
 * this checks the newest reading independently of that commit cadence.
 * Deliberately mirrors `apps/web/lib/dead-man.ts`'s shape (same "no
 * reading yet is not staleness" rule) at a different threshold and for a
 * different audience — this one drives a CI failure + GitHub issue, that
 * one drives a site banner.
 */
export const HEALTH_STALE_THRESHOLD_DAYS = 14;

export interface HealthState {
  /** `true` only when a newest reading exists AND it is strictly more than `HEALTH_STALE_THRESHOLD_DAYS` old. */
  stale: boolean;
  /** `null` when there has never been a real reading at all — the pre-launch state, not staleness. */
  daysSinceNewestReading: number | null;
}

/** `newestReadingIso`/`nowIso` are both ISO-8601 timestamps. Pure — no ambient clock read inside. */
export function computeHealthState(
  newestReadingIso: string | undefined,
  nowIso: string,
  thresholdDays: number = HEALTH_STALE_THRESHOLD_DAYS,
): HealthState {
  if (newestReadingIso === undefined) return { stale: false, daysSinceNewestReading: null };
  const ageMs = Date.parse(nowIso) - Date.parse(newestReadingIso);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return { stale: ageDays > thresholdDays, daysSinceNewestReading: Math.floor(ageDays) };
}

/**
 * The most recent index-chain entry's `at` among entries that actually
 * produced at least one reading (`cells.length > 0`) — a `status:
 * "skipped"` entry (SPEC §8's mitigation commit) has `cells: []` and must
 * NOT count as "a reading landed" here, or a repo could commit skipped
 * entries forever while the observatory's real content silently rots.
 * `undefined` when no entry has ever produced a reading.
 */
export function newestRealReadingAt(entries: readonly { at: string; cells: readonly unknown[] }[]): string | undefined {
  const withReadings = entries.filter((e) => e.cells.length > 0);
  if (withReadings.length === 0) return undefined;
  return withReadings.reduce((latest, e) => (e.at > latest ? e.at : latest), withReadings[0]?.at ?? "");
}
