"use client";

import { useEffect, useState } from "react";
import { computeDeadManState, DEAD_MAN_THRESHOLD_DAYS, type DeadManState } from "@/lib/dead-man";

/**
 * SPEC §8/§10: the dead-man banner must use CLIENT-side arithmetic — a
 * statically exported page, once built, never changes its HTML again, so
 * "is the newest reading stale" has to be computed against the VISITOR's
 * own clock at page-load, not baked in at build time. `newestReadingIso`
 * is `undefined` when the observatory has never had a reading (SPEC §11's
 * launch state — a distinct, honest message, not staleness) — this
 * component renders nothing in that case; the launch-state copy on `/`
 * owns it instead.
 */
export function DeadManBanner({ newestReadingIso }: { newestReadingIso: string | undefined }) {
  const [state, setState] = useState<DeadManState | null>(null);

  useEffect(() => {
    setState(computeDeadManState(newestReadingIso, new Date().toISOString()));
  }, [newestReadingIso]);

  if (newestReadingIso === undefined) return null;
  if (!state?.stale) return null;

  return (
    <div
      role="status"
      className="border border-amber bg-amber/10 text-ink px-4 py-3 text-sm mb-6"
      data-testid="dead-man-banner"
    >
      <strong className="font-semibold">Stale observatory.</strong> The newest reading is{" "}
      {state.daysSinceNewestReading} days old — more than the {DEAD_MAN_THRESHOLD_DAYS}-day threshold. This
      site is honest about it rather than implying currency; see{" "}
      <a href="/methodology" className="underline">
        methodology
      </a>{" "}
      for the schedule this is measured against.
    </div>
  );
}
