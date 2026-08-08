import { Fragment } from "react";
import Link from "next/link";
import { activeItems, meetsNegativesQuota, suiteSpecHash } from "tiltmeter";
import { loadAllSuites, loadAllReadings, totalActiveItemCount } from "@/lib/observatory";
import { buildSeriesByCellId, shortHash } from "@/lib/instrument";
import { newestReadingTimestamp } from "@/lib/dead-man";
import { LAUNCH_DATE } from "@/lib/constants";
import { DeadManBanner } from "@/components/DeadManBanner";

// SPEC §7: every route statically prerendered — Next.js itself refuses to
// build this page if anything makes it dynamic.
export const dynamic = "error";

export default function HomePage() {
  const suites = loadAllSuites();
  const allReadings = loadAllReadings();
  const newestReadingIso = newestReadingTimestamp(allReadings);
  const itemCount = totalActiveItemCount();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">tiltmeter</h1>
      <p className="mt-2 text-ink/70 max-w-prose">
        Tells an operator when a new model release moves <em>their</em> agent harness off true — a harness
        artifact, pinned to a commit, probed with deterministic scorers. Every published number is scoped to
        (suite, harness commit, model), never to a model alone.
      </p>

      <DeadManBanner newestReadingIso={newestReadingIso} />

      {allReadings.length === 0 ? (
        <section className="mt-8 border hairline p-5 bg-white/40" data-testid="launch-state">
          <p>
            tiltmeter launched {LAUNCH_DATE} with {suites.length} pre-registered suites and {itemCount} items.
            There is no time series yet — that is what pre-registration means. The series starts here.
          </p>
        </section>
      ) : null}

      <div className="mt-10 space-y-8">
        {suites.map((suite) => {
          const suiteReadings = allReadings.filter((r) => r.suiteId === suite.id);
          const seriesByCellId = buildSeriesByCellId(suiteReadings);
          const active = activeItems(suite);
          const negatives = active.filter((i) => i.polarity === "negative").length;

          return (
            <section key={suite.id} className="border-t hairline pt-6" data-testid={`suite-${suite.id}`}>
              <h2 className="font-semibold">
                <Link href={`/suites/${suite.id}`} className="hover:text-amber">
                  {suite.id}
                </Link>
              </h2>
              <p className="text-sm text-ink/60 mt-1">
                {active.length} active items ({negatives} negative, {meetsNegativesQuota(suite) ? "quota met" : "quota NOT met"}) ·
                current suiteSpecHash <code className="font-mono">{shortHash(suiteSpecHash(suite))}</code>
              </p>

              {seriesByCellId.size === 0 ? (
                <p className="text-sm text-ink/60 mt-3">No readings for this suite yet.</p>
              ) : (
                <div className="mt-3 space-y-4">
                  {[...seriesByCellId.entries()].map(([cellId, points]) => (
                    <div key={cellId}>
                      <h3 className="text-sm font-medium">{cellId}</h3>
                      <table className="mt-1 text-sm w-full border-collapse">
                        <thead>
                          <tr className="text-left text-ink/60">
                            <th className="pr-4 font-normal">Run group</th>
                            <th className="pr-4 font-normal">Status</th>
                            <th className="pr-4 font-normal">Overall</th>
                          </tr>
                        </thead>
                        <tbody>
                          {points.map((p) => (
                            <Fragment key={p.runGroupId}>
                              {p.hardBreakBefore ? (
                                <tr key={`${p.runGroupId}-break`}>
                                  <td colSpan={3} className="text-amber text-xs py-1">
                                    suite rebaselined — series restarts
                                  </td>
                                </tr>
                              ) : null}
                              <tr key={p.runGroupId} className="border-t hairline">
                                <td className="pr-4 py-1">
                                  <Link href={`/readings/${p.runGroupId}`} className="hover:text-amber">
                                    {p.runGroupId}
                                  </Link>
                                </td>
                                <td className="pr-4 py-1">{p.status}</td>
                                <td className="pr-4 py-1">
                                  {p.metrics.overall !== undefined ? p.metrics.overall.toFixed(3) : "—"}
                                </td>
                              </tr>
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
