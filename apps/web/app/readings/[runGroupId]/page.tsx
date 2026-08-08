import type { Metadata } from "next";
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
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Readings</h1>
        <p className="mt-4 text-ink/70 max-w-prose" data-testid="no-run-groups-yet">
          No run group has been recorded yet. The first run group spends real API budget and is a deliberate,
          James-gated step — see <code>observatory/readings/README.md</code>. Once one lands, it appears here.
        </p>
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
              <dt className="text-ink/60">Status</dt>
              <dd>{reading.status}</dd>
              <dt className="text-ink/60">Model resolved</dt>
              <dd>{reading.axes.modelIdResolved}</dd>
              <dt className="text-ink/60">Completeness</dt>
              <dd>
                {reading.completeness.ok}/{reading.completeness.expectedTrials} ok, {reading.completeness.noResult} noResult
              </dd>
              <dt className="text-ink/60">Cost (actual)</dt>
              <dd>{reading.cost !== undefined ? `$${reading.cost.actualUsd.toFixed(4)}` : "—"}</dd>
              <dt className="text-ink/60">suiteSpecHash</dt>
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

            <p className="mt-3 text-xs text-ink/60">
              Reproduce: <code>tiltmeter run --plan {reading.runGroupId}</code>
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
