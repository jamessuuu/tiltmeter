/**
 * The dead-man banner's pure decision (SPEC §10 "/": "Dead-man banner when
 * the newest reading is >10 days old"; SPEC §8: "the site's dead-man
 * banner (>10 days) is the public-facing honesty: a stale observatory says
 * it is stale rather than implying currency"). Deliberately isolated from
 * React so it is unit-testable at the exact boundary without a DOM.
 *
 * "Client-side arithmetic, works with functions paused" (M6 task): this
 * function's SECOND argument must be evaluated in the VISITOR's browser at
 * PAGE-LOAD time, not baked in at `next build` time — a statically
 * exported page built once and never rebuilt would otherwise show "not
 * stale" forever. `components/DeadManBanner.tsx` is the client component
 * that supplies a real, client-computed `now`.
 */
export const DEAD_MAN_THRESHOLD_DAYS = 10;

export interface DeadManState {
  /** `true` only when a newest reading exists AND it is strictly more than `DEAD_MAN_THRESHOLD_DAYS` old. */
  stale: boolean;
  /** `null` when there has never been a reading at all — that is the SPEC §11 launch state, not staleness (a different, honest message owns that case). */
  daysSinceNewestReading: number | null;
}

/** `newestReadingIso`/`nowIso` are both ISO-8601 timestamps. Pure — no ambient clock read inside. */
export function computeDeadManState(newestReadingIso: string | undefined, nowIso: string): DeadManState {
  if (newestReadingIso === undefined) return { stale: false, daysSinceNewestReading: null };
  const ageMs = Date.parse(nowIso) - Date.parse(newestReadingIso);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return { stale: ageDays > DEAD_MAN_THRESHOLD_DAYS, daysSinceNewestReading: Math.floor(ageDays) };
}

/** The most recent reading's `finishedAt` across a set of readings, or `undefined` if there are none — the exact input `computeDeadManState` wants. */
export function newestReadingTimestamp(readings: readonly { finishedAt: string }[]): string | undefined {
  if (readings.length === 0) return undefined;
  return readings.reduce((latest, r) => (r.finishedAt > latest ? r.finishedAt : latest), readings[0]?.finishedAt ?? "");
}
