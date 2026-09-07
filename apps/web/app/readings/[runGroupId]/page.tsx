import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listRunGroupIds, loadReadingsForRunGroup } from "@/lib/observatory";
import { shortHash } from "@/lib/instrument";

export const dynamic = "error";
export const dynamicParams = false;

/** The one honest placeholder param used ONLY while `observatory/readings/` is empty (see its own README) — `output: "export"` requires at least one static param per dynamic segment, and fabricating a fake run group id would be dishonest, so this well-known, clearly-named slug renders a real "no run groups yet" page instead. The moment a real run group lands, `listRunGroupIds()` returns it and this placeholder stops being generated at all. */
const EMPTY_PLACEHOLDER_ID = "none-yet";

export function generateStaticParams() {
  const real = listRunGroupIds();
  return (real.length === 0 ? [EMPTY_PLACEHOLDER_ID] : real).map((runGroupId) => ({ runGroupId }));
}

// Next.js 16 App Router: `params` is a Promise — see the matching comment
// in app/suites/[id]/page.tsx for why this must be awaited, never used
// synchronously.
export async function generateMetadata({ params }: { params: Promise<{ runGroupId: string }> }): Promise<Metadata> {
  const { runGroupId } = await params;
  return { title: runGroupId === EMPTY_PLACEHOLDER_ID ? "Readings" : runGroupId };
}

/** SPEC §10: "every cell, completeness, actual USD cost, per-item table with held/broke/fixed/flaky, the pre-registration triple… the exact tiltmeter command to reproduce, and a raw-JSON link." */
export default async function ReadingPage({ params }: { params: Promise<{ runGroupId: string }> }) {
  const { runGroupId } = await params;
  const ids = listRunGroupIds();

  if (ids.length === 0 && runGroupId === EMPTY_PLACEHOLDER_ID) {
    return (
      <main>
        <div className="ambient border-b hairline">
          <div className="mx-auto max-w-5xl px-6 pb-12 pt-14">
            <div className="flex items-center gap-3 rise">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/70">
                Readings
              </span>
              <span className="h-px flex-1 bg-rule" aria-hidden="true" />
              <span className="font-mono text-[11px] text-ink/65">none taken</span>
            </div>
            <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl rise rise-2">
              Readings
            </h1>
            <p
              className="mt-5 max-w-[58ch] text-[19px] leading-[1.5] text-ink/80 rise rise-2"
              data-testid="no-run-groups-yet"
              style={{ fontFamily: "var(--font-editorial)" }}
            >
              No run group has been recorded yet. The first run group spends real API budget and is a
              deliberate, James-gated step — see <code>observatory/readings/README.md</code>. Once one lands,
              it appears here.
            </p>
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-6 pb-24">
          <div className="panel mt-12 p-6 sm:p-7">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-ink/70">
              What has happened instead
            </h2>
            <p className="mt-3 max-w-[66ch] text-[15px] leading-relaxed text-ink/70">
              The schedule has still been running. Every week it commits a record of what it did — so far,
              that it refused, and why — hash-linked to the one before it. That chain is on the{" "}
              <Link
                href="/"
                prefetch={false}
                className="underline decoration-rule underline-offset-4 hover:text-amber"
              >
                landing page
              </Link>
              , alongside the calibration the detector had to clear before any reading would be worth
              publishing.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!ids.includes(runGroupId)) notFound();
  const readings = loadReadingsForRunGroup(runGroupId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{runGroupId}</h1>

      <div className="mt-6 space-y-6">
        {readings.map((reading) => (
          <section key={`${reading.suiteId}__${reading.cellId}`} className="border hairline p-4">
            <h2 className="font-semibold">
              {reading.suiteId} × {reading.cellId}
            </h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm max-w-md">
              <dt className="text-ink/75">Status</dt>
              <dd>{reading.status}</dd>
              <dt className="text-ink/75">Model resolved</dt>
              <dd>{reading.axes.modelIdResolved}</dd>
              <dt className="text-ink/75">Completeness</dt>
              <dd>
                {reading.completeness.ok}/{reading.completeness.expectedTrials} ok, {reading.completeness.noResult} noResult
              </dd>
              <dt className="text-ink/75">Cost (actual)</dt>
              <dd>{reading.cost !== undefined ? `$${reading.cost.actualUsd.toFixed(4)}` : "—"}</dd>
              <dt className="text-ink/75">suiteSpecHash</dt>
              <dd className="font-mono">{shortHash(reading.axes.suiteSpecHash)}</dd>
            </dl>

            <table className="mt-3 w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b hairline">
                  <th className="pr-4 py-1 font-normal">Item</th>
                  <th className="pr-4 py-1 font-normal">Passes</th>
                </tr>
              </thead>
              <tbody>
                {reading.items.map((item) => (
                  <tr key={item.id} className="border-b hairline">
                    <td className="pr-4 py-1 font-mono text-xs">{item.id}</td>
                    <td className="pr-4 py-1">
                      {item.passes}/{item.k}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-3 text-xs text-ink/75">
              Reproduce: <code>tiltmeter run --plan {reading.runGroupId}</code>
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
