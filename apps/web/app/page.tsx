import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { activeItems, meetsNegativesQuota, suiteSpecHash } from "tiltmeter";
import { loadAllSuites, loadAllReadings, totalActiveItemCount } from "@/lib/observatory";
import { buildSeriesByCellId, shortHash } from "@/lib/instrument";
import { newestReadingTimestamp } from "@/lib/dead-man";
import { loadCalibration, formatPct } from "@/lib/calibration";
import { LAUNCH_DATE } from "@/lib/constants";
import { DeadManBanner } from "@/components/DeadManBanner";
import { AttributionDiagram } from "@/components/AttributionDiagram";
import { DemoVideo } from "@/components/DemoVideo";

// SPEC §7: every route statically prerendered — Next.js itself refuses to
// build this page if anything makes it dynamic.
export const dynamic = "error";

export default function HomePage() {
  const suites = loadAllSuites();
  const allReadings = loadAllReadings();
  const newestReadingIso = newestReadingTimestamp(allReadings);
  const itemCount = totalActiveItemCount();
  const calibration = loadCalibration();

  const allActiveItems = suites.flatMap((suite) => activeItems(suite));
  const negativeCount = allActiveItems.filter((item) => item.polarity === "negative").length;
  const negativePct = allActiveItems.length > 0 ? ((negativeCount / allActiveItems.length) * 100).toFixed(1) : "0.0";

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      {/* ---- hero: name, one-line claim, the two calibration numbers ---- */}
      {/* The project glyph leads its own page: BRAND-KIT "Icon hierarchy"
       * (2026-08-09) — the glyph is the identity, the chip in the footer is
       * the maker's mark. Before this, tiltmeter's own mark appeared nowhere
       * on the page it belongs to, only as a favicon. Decorative next to the
       * name it duplicates, so it is aria-hidden. */}
      <div className="flex items-center gap-3">
        <Image
          src="/brand/glyph.svg"
          alt=""
          aria-hidden="true"
          width={36}
          height={36}
          priority
        />
        <h1 className="text-2xl font-semibold tracking-tight">tiltmeter</h1>
      </div>
      <p className="mt-2 text-ink/70 max-w-prose">
        Tells an operator when a new model release moves <em>their</em> agent harness off true — a harness
        artifact, pinned to a commit, probed with deterministic scorers. Every published number is scoped to
        (suite, harness commit, model), never to a model alone.
      </p>

      <DeadManBanner newestReadingIso={newestReadingIso} />

      <div className="mt-8 grid grid-cols-2 gap-6 max-w-md border-t hairline pt-6" data-testid="calibration-numbers">
        <div>
          <div className="text-4xl font-semibold tabular-nums">{formatPct(calibration.falsePositive.rate)}</div>
          <div className="mt-1 text-xs text-ink/60">
            false-positive rate — {calibration.falsePositive.trials} null pairs
          </div>
        </div>
        <div>
          <div className="text-4xl font-semibold tabular-nums text-amber">
            {formatPct(calibration.detectionPower.rate)}
          </div>
          <div className="mt-1 text-xs text-ink/60">
            detection power — {calibration.detectionPower.trials} planted degradations
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink/50 max-w-prose">
        Both numbers come from a seeded simulation (<code>pnpm calibration</code>), not a threshold picked by
        eye — CI regenerates them on every push and fails on drift. Detail on{" "}
        <Link href="/methodology" className="underline hover:text-amber">
          methodology
        </Link>
        .
      </p>

      {/* ---- the diagram: the one idea that explains faster than prose ---- */}
      <section className="mt-12 border-t hairline pt-8" aria-labelledby="diagram-heading">
        <h2 id="diagram-heading" className="font-semibold">
          How a comparison resolves
        </h2>
        <p className="mt-2 text-sm text-ink/70 max-w-prose">
          A cell&apos;s identity is five hashes: which suite, which model, which runner behavior, which
          presentation, which sampling policy. Two readings are only compared when exactly one of those five
          changed — that is the only shape of question this project will answer.
        </p>
        <AttributionDiagram />
      </section>

      {/* ---- the demo: a scripted run against the real deployed site ---- */}
      <section className="mt-12 border-t hairline pt-8" aria-labelledby="demo-heading">
        <h2 id="demo-heading" className="font-semibold">
          See it run
        </h2>
        <p className="mt-2 text-sm text-ink/70 max-w-prose">
          Recorded against this site as deployed, not a local build — if the site were broken, the recording
          would be too.
        </p>
        <DemoVideo />
      </section>

      {/* ---- the pre-registration argument ---- */}
      <section className="mt-12 border-t hairline pt-8" aria-labelledby="prereg-heading">
        <h2 id="prereg-heading" className="font-semibold">
          Pre-registered, not fitted after the fact
        </h2>
        <p className="mt-2 text-sm text-ink/70 max-w-prose">
          The four suites below were committed to this repo on {LAUNCH_DATE}, before any reading has ever been
          taken and before whatever model release eventually moves one of them exists. Git history is the
          proof — a suite&apos;s registration date and a model&apos;s cited release date are both public and
          both checkable, so nobody has to take &quot;pre-registered&quot; on faith.
        </p>
        <pre className="mt-4 border hairline bg-white/40 p-3 text-sm overflow-x-auto">
          <code>npx tiltmeter@1 verify</code>
        </pre>
        <p className="mt-2 text-sm text-ink/70 max-w-prose">
          For each reading it recomputes <code>suiteSpecHash</code> from the suite file, walks git history for
          the first commit whose tree contains that hash, reads the model&apos;s cited release date, and
          asserts the suite was registered first — printing the commit SHA and both dates. The git history is
          the actual proof; the command just makes checking it a 30-second job instead of an afternoon.
        </p>
      </section>

      {/* ---- suite inventory + today's (empty) series ---- */}
      <section className="mt-12 border-t hairline pt-8" aria-labelledby="suites-heading">
        <h2 id="suites-heading" className="font-semibold">
          The four launch suites
        </h2>
        <p className="mt-2 text-sm text-ink/70 max-w-prose">
          {itemCount} active items across {suites.length} suites, {negativeCount} of them ({negativePct}%)
          negative — a suite that only ever tests the happy path cannot tell you when it starts firing on
          everything.
        </p>

        <div className="mt-8 space-y-8">
          {suites.map((suite) => {
            const suiteReadings = allReadings.filter((r) => r.suiteId === suite.id);
            const seriesByCellId = buildSeriesByCellId(suiteReadings);
            const active = activeItems(suite);
            const negatives = active.filter((i) => i.polarity === "negative").length;

            return (
              <section key={suite.id} className="border-t hairline pt-6" data-testid={`suite-${suite.id}`}>
                <h3 className="font-semibold">
                  <Link href={`/suites/${suite.id}`} className="hover:text-amber">
                    {suite.id}
                  </Link>
                </h3>
                <p className="text-sm text-ink/60 mt-1">
                  {active.length} active items ({negatives} negative,{" "}
                  {meetsNegativesQuota(suite) ? "quota met" : "quota NOT met"}) · current suiteSpecHash{" "}
                  <code className="font-mono">{shortHash(suiteSpecHash(suite))}</code>
                </p>

                {seriesByCellId.size === 0 ? (
                  <p className="text-sm text-ink/60 mt-3">No readings for this suite yet.</p>
                ) : (
                  <div className="mt-3 space-y-4">
                    {[...seriesByCellId.entries()].map(([cellId, points]) => (
                      <div key={cellId}>
                        <h4 className="text-sm font-medium">{cellId}</h4>
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
      </section>

      {/* ---- the honest launch state ---- */}
      {allReadings.length === 0 ? (
        <section className="mt-12 border hairline p-5 bg-white/40" data-testid="launch-state">
          <p>
            tiltmeter launched {LAUNCH_DATE} with {suites.length} pre-registered suites and {itemCount} items.
            There is no time series yet — that is what pre-registration means. The series starts here.
          </p>
        </section>
      ) : null}

      {/* ---- install ---- */}
      <section className="mt-12 border-t hairline pt-8" aria-labelledby="install-heading">
        <h2 id="install-heading" className="font-semibold">
          Install
        </h2>
        <p className="mt-2 text-sm text-ink/70 max-w-prose">
          The first three commands below run with no API key and no network — proven against the packed npm
          tarball in a clean directory, not just in this repo.
        </p>
        <pre className="mt-4 border hairline bg-white/40 p-3 text-sm overflow-x-auto">
          <code>{`npx tiltmeter@1 init --from-skills <dir>
npx tiltmeter@1 lint
npx tiltmeter@1 plan --run-group <id> --offline`}</code>
        </pre>
        <p className="mt-4 text-sm text-ink/70 max-w-prose">
          Full walkthrough on{" "}
          <Link href="/docs" className="underline hover:text-amber">
            docs
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
