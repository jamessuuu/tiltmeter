import {
  chainIsUnbroken,
  findCostShift,
  isoDate,
  newestPlan,
  usd,
  type RunGroupRecord,
} from "@/lib/watch";
import { ArrowRight } from "@/components/Marks";

/**
 * What the schedule has actually done (2026-09-07). This section did not
 * exist: the site said "No readings for this suite yet." four times and
 * never mentioned that the scheduled job had fired four times, refused
 * four times for a stated reason, and hash-linked every refusal to the one
 * before it.
 *
 * That is the honest launch state rendered as evidence instead of as an
 * apology — and it is a stronger claim than a reading would be, because it
 * shows the machine running with nothing to gain from lying.
 */

function ChainRow({ record, index }: { record: RunGroupRecord; index: number }) {
  const { entry, plan, hashShort, prevHashShort } = record;
  return (
    <li className="relative pl-8 rise" style={{ animationDelay: `${String(index * 60)}ms` }}>
      <span
        className="chain-node absolute left-0 top-[7px] h-3 w-3 rounded-full border-2 border-amber bg-paper"
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm font-semibold tabular-nums">{entry.runGroupId}</span>
        <span className="text-xs text-ink/50 tabular-nums">{isoDate(entry.at)}</span>
        <span className="rounded-full bg-ink/6 px-2 py-[2px] font-mono text-[11px] text-ink/70">
          {entry.status}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink/65">
        {entry.reason ?? "—"}
        {plan !== undefined ? (
          <>
            {" · planned "}
            <span className="tabular-nums">{usd(plan.totalEstimatedUsd)}</span>
            {", spent "}
            <span className="tabular-nums">${entry.costUsd.toFixed(2)}</span>
          </>
        ) : null}
      </p>
      <p className="mt-1 font-mono text-[11px] text-ink/40">
        {prevHashShort === undefined ? "genesis" : `${prevHashShort} →`} {hashShort}
      </p>
    </li>
  );
}

export function WatchChain({ records }: { records: RunGroupRecord[] }) {
  if (records.length === 0) return null;
  const unbroken = chainIsUnbroken(records);
  const shift = findCostShift(records);
  const plan = newestPlan(records);
  const skipped = records.filter((r) => r.entry.status === "skipped").length;

  return (
    <section className="mt-20" aria-labelledby="watch-heading" data-testid="watch-chain">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="watch-heading" className="text-2xl font-semibold tracking-[-0.02em]">
          The schedule has already run {records.length} times
        </h2>
        <span className="font-mono text-xs text-ink/50">
          {unbroken ? "chain verified unbroken at build" : "CHAIN BROKEN"}
        </span>
      </div>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-ink/70">
        Every run committed a record and linked it to the one before it. All {skipped} refused, for the
        same stated reason, and said so in public rather than publishing a number nobody paid for.
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="panel p-6 sm:p-7">
          <ol className="chain-rail relative flex flex-col gap-6">
            {records.map((r, i) => (
              <ChainRow key={r.entry.runGroupId} record={r} index={i} />
            ))}
          </ol>
        </div>

        {shift !== undefined ? (
          <div className="panel panel-hover p-6 sm:p-7 rise rise-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-ink/55">
              What it caught while waiting
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/70">
              {shift.sameWork ? "The identical plan" : "The plan"} — {shift.cellCount} cells,{" "}
              <span className="tabular-nums">{shift.itemRuns}</span> item runs, unchanged — repriced
              itself when a standing model&apos;s published price moved.
            </p>
            <div className="mt-6 flex items-end gap-4">
              <div>
                <div className="font-mono text-3xl font-semibold tabular-nums tracking-[-0.03em] text-ink/40 line-through decoration-ink/30 decoration-1">
                  {usd(shift.fromUsd)}
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink/45">{shift.fromRunGroupId}</div>
              </div>
              <div className="pb-3 text-ink/35">
                <ArrowRight />
              </div>
              <div>
                <div className="font-mono text-4xl font-semibold tabular-nums tracking-[-0.035em] text-amber">
                  {usd(shift.toUsd)}
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink/45">{shift.toRunGroupId}</div>
              </div>
            </div>
            <p className="mt-5 text-sm text-ink/65">
              <span className="font-semibold tabular-nums text-ink">
                +{shift.deltaPct.toFixed(1)}%
              </span>{" "}
              for the same work, on {shift.movedCellIds.join(" + ")} — read from the dated pricing
              manifest, not from a hardcoded rate.
            </p>
            {plan !== undefined ? (
              <p className="mt-4 border-t hairline pt-4 font-mono text-[11px] leading-relaxed text-ink/50">
                caps ${plan.caps.maxCellUsd.toFixed(2)}/cell · ${plan.caps.maxRunUsd.toFixed(2)}/run · $
                {plan.caps.maxMonthUsd.toFixed(2)}/month
                <br />
                pricing manifest {plan.pricingManifestId}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
