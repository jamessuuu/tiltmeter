import Link from "next/link";
import { activeItems } from "tiltmeter";
import { loadAllSuites, loadAllReadings, totalActiveItemCount, loadPricingManifest } from "@/lib/observatory";
import { newestReadingTimestamp } from "@/lib/dead-man";
import { loadCalibration } from "@/lib/calibration";
import { LAUNCH_DATE } from "@/lib/constants";
import { loadRunGroupRecords } from "@/lib/watch";
import { DeadManBanner } from "@/components/DeadManBanner";
import { AttributionDiagram } from "@/components/AttributionDiagram";
import { DemoVideo } from "@/components/DemoVideo";
import { CalibrationGates, CalibrationReadout } from "@/components/CalibrationGates";
import { WatchChain } from "@/components/WatchChain";
import { SuiteGrid } from "@/components/SuiteGrid";

// SPEC §7: every route statically prerendered — Next.js itself refuses to
// build this page if anything makes it dynamic.
export const dynamic = "error";

/** Deterministic thousands grouping — no locale, no ICU variance. */
function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export default function HomePage() {
  const suites = loadAllSuites();
  const allReadings = loadAllReadings();
  const newestReadingIso = newestReadingTimestamp(allReadings);
  const itemCount = totalActiveItemCount();
  const calibration = loadCalibration();
  const records = loadRunGroupRecords();
  const pricing = loadPricingManifest();

  const allActiveItems = suites.flatMap((suite) => activeItems(suite));
  const negativeCount = allActiveItems.filter((item) => item.polarity === "negative").length;
  const negativePct = allActiveItems.length > 0 ? ((negativeCount / allActiveItems.length) * 100).toFixed(1) : "0.0";
  const totalTrials = calibration.falsePositive.trials + calibration.detectionPower.trials;
  const resamples = totalTrials * calibration.bootstrapB;

  return (
    <main>
      {/* ================================================== hero ========== */}
      <div className="ambient border-b hairline">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-14 sm:pt-20">
          <div className="flex items-center gap-3 rise">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-ink/55">tiltmeter</p>
            <span className="h-px flex-1 bg-rule" aria-hidden="true" />
            <span className="font-mono text-[11px] text-ink/45">pre-release · {LAUNCH_DATE}</span>
          </div>

          <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] lg:gap-14">
            <div>
              <h1 className="max-w-[17ch] text-[42px] font-semibold leading-[1.03] tracking-[-0.035em] sm:text-6xl lg:text-[68px] rise rise-2">
                The detector fires when your harness moves, and{" "}
                <span className="text-amber">not when it doesn&apos;t</span>.
              </h1>

              <p
                className="mt-7 max-w-[56ch] text-[19px] leading-[1.55] text-ink/75 rise rise-2"
                style={{ fontFamily: "var(--font-editorial)" }}
              >
                A model release either changed how your skill descriptions, tool schemas and output
                contracts behave, or it didn&apos;t. Both answers are only worth having from an instrument
                whose error rates are known — so those were measured first, before a single reading was
                taken.
              </p>

              <div className="mt-8 flex flex-wrap gap-2 rise rise-3">
                {[
                  `${group(totalTrials)} seeded trials`,
                  `B = ${group(calibration.bootstrapB)} resamples each`,
                  `${String(calibration.itemCount)}-item pool`,
                  `${String(calibration.degradedCount)} planted`,
                  "pnpm calibration",
                  "$0",
                ].map((chip) => (
                  <span
                    key={chip}
                    className="well px-3 py-1.5 font-mono text-[11.5px] tracking-tight text-ink/65"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            <div className="rise rise-4">
              <CalibrationReadout calibration={calibration} />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-24">
        <DeadManBanner newestReadingIso={newestReadingIso} />

        {/* ============================================ the two gates ====== */}
        <section className="mt-14" aria-labelledby="gates-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 id="gates-heading" className="text-2xl font-semibold tracking-[-0.02em]">
              Both calibration gates, cleared
            </h2>
            <Link
              href="/methodology"
              prefetch={false}
              className="inline-flex items-center py-1 font-mono text-xs text-ink/55 underline decoration-rule underline-offset-4 hover:text-amber"
            >
              methodology →
            </Link>
          </div>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            A seeded simulation, re-run by CI on every push and failed on drift — never a threshold picked
            by eye. {group(resamples)} bootstrap resamples in total.
          </p>
          <div className="mt-8">
            <CalibrationGates calibration={calibration} />
          </div>
        </section>

        {/* ============================================ the watch ========= */}
        <WatchChain records={records} />

        {/* ============================================ mechanism ========= */}
        <section className="mt-20" aria-labelledby="diagram-heading">
          <h2 id="diagram-heading" className="text-2xl font-semibold tracking-[-0.02em]">
            How a comparison resolves
          </h2>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            A cell&apos;s identity is five hashes: suite, model, runner behavior, presentation, sampling
            policy. Change exactly one and the comparison resolves to a verdict. Change two and it refuses,
            naming the axes rather than guessing.
          </p>
          <div className="panel mt-8 p-4 sm:p-8">
            <AttributionDiagram />
          </div>
        </section>

        {/* ============================================ demo ============== */}
        <section className="mt-20" aria-labelledby="demo-heading">
          <h2 id="demo-heading" className="text-2xl font-semibold tracking-[-0.02em]">
            See it run
          </h2>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            Recorded against this site as deployed, not a local build — if the site were broken, the
            recording would be too.
          </p>
          <div className="panel mt-8 p-4 sm:p-6">
            <DemoVideo />
          </div>
        </section>

        {/* ============================================ suites ============ */}
        <section className="mt-20" aria-labelledby="suites-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 id="suites-heading" className="text-2xl font-semibold tracking-[-0.02em]">
              The four launch suites
            </h2>
            <span className="font-mono text-xs tabular-nums text-ink/50">
              {itemCount} items · {negativeCount} negative ({negativePct}%)
            </span>
          </div>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            Committed on {LAUNCH_DATE}, before any reading and before whatever release eventually moves one
            of them exists. A suite that only ever tests the happy path cannot tell you when it starts
            firing on everything — so every suite carries a negatives quota.
          </p>

          <SuiteGrid suites={suites} />

          <details className="group mt-6">
            <summary className="inline-flex items-center gap-2 text-sm text-ink/60 hover:text-amber">
              <span className="font-mono text-xs transition-transform group-open:rotate-90">▸</span>
              How pre-registration is checked, not claimed
            </summary>
            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <p className="max-w-[62ch] text-[15px] leading-relaxed text-ink/70">
                For each reading, <code className="font-mono text-[13px]">verify</code> recomputes{" "}
                <code className="font-mono text-[13px]">suiteSpecHash</code> from the suite file, walks git
                history for the first commit whose tree contains that hash, reads the model&apos;s cited
                release date, and asserts the suite was registered first — printing the commit SHA and both
                dates. Git history is the actual proof; the command just makes checking it a 30-second job.
              </p>
              <pre className="well overflow-x-auto p-4 font-mono text-[13px]">
                <code>npx tiltmeter@1 verify</code>
              </pre>
            </div>
          </details>
        </section>

        {/* ============================================ launch state ====== */}
        {allReadings.length === 0 ? (
          <section className="panel-float mt-20 p-7 sm:p-9" data-testid="launch-state">
            <p className="max-w-[64ch] text-[17px] leading-relaxed">
              tiltmeter launched {LAUNCH_DATE} with {suites.length} pre-registered suites and {itemCount}{" "}
              items. There is no time series yet — that is what pre-registration means. The series starts
              here.
            </p>
            <p className="mt-4 max-w-[64ch] text-sm text-ink/60">
              The first run group spends real money and is a deliberate, gated step. Until it is taken, the
              schedule keeps publishing what it did instead — {records.length} records so far, priced
              against a pricing manifest fetched {pricing.fetchedAt}.
            </p>
          </section>
        ) : null}

        {/* ============================================ install =========== */}
        <section className="mt-20" aria-labelledby="install-heading">
          <h2 id="install-heading" className="text-2xl font-semibold tracking-[-0.02em]">
            Install
          </h2>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            The first three commands run with no API key and no network — proven against the packed npm
            tarball in a clean directory, not just in this repo.
          </p>
          <pre className="well mt-6 overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
            <code>{`npx tiltmeter@1 init --from-skills <dir>
npx tiltmeter@1 lint
npx tiltmeter@1 plan --run-group <id> --offline`}</code>
          </pre>
          <p className="mt-4 text-sm text-ink/65">
            Full walkthrough on{" "}
            <Link href="/docs" prefetch={false} className="underline decoration-rule underline-offset-4 hover:text-amber">
              docs
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
