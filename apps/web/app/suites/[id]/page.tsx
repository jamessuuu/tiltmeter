import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { activeItems, meetsNegativesQuota, suiteSpecHash } from "tiltmeter";
import { listSuiteIds, loadSuite } from "@/lib/observatory";
import { shortHash } from "@/lib/instrument";

export const dynamic = "error";
// No page is generated for a suite id not returned by generateStaticParams
// below (SPEC §7: statically prerendered, nothing dynamic) — visiting an
// unknown id 404s at build/serve time, never renders on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return listSuiteIds().map((id) => ({ id }));
}

// Next.js 16 App Router: `params` is a Promise, not a plain object — MUST
// be awaited (both here and in the page component below). Using it
// synchronously silently gives `undefined` for every field rather than a
// type error, which (found by testing) makes `notFound()` fire on every
// visit while still returning HTTP 200 for a pre-built static file — a
// genuinely dangerous silent-failure shape for a statically exported site.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: id };
}

/**
 * SPEC §10: "items including retired ones with retirement reasons, artifact
 * provenance levels, registration dates, current suiteSpecHash."
 *
 * Rebuilt 2026-09-07. This page rendered every item as its own sentence —
 * "pos-taste-1 — positive, activation, registered 2026-08-09" — thirty-two
 * times, with the last five words identical in all thirty-two, and every
 * artifact as a card whose third line repeated the same provenance
 * disclaimer ten times. Repetition at that scale is not thoroughness, it is
 * noise that hides the composition. Facts shared by every row are now
 * stated ONCE above the set, and the set itself renders as a grid where
 * polarity is visible at a glance. Nothing is dropped: anything that
 * DIFFERS from the shared case (a public artifact's repo/commit, a retired
 * item's date and reason) still renders in full, per row.
 */

function Spec({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-[0.1em] text-ink/50">{k}</dt>
      <dd className={`mt-1 text-[15px] font-semibold tracking-[-0.01em] ${mono ? "font-mono tabular-nums" : ""}`}>
        {v}
      </dd>
    </div>
  );
}

export default async function SuitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ids = listSuiteIds();
  if (!ids.includes(id)) notFound();
  const suite = loadSuite(id);
  const active = activeItems(suite);
  const retired = suite.items.filter((i) => i.retired !== undefined);
  const negatives = active.filter((i) => i.polarity === "negative").length;
  const negativePct = active.length > 0 ? (negatives / active.length) * 100 : 0;

  // Facts true of EVERY row get stated once; anything that varies still
  // renders per row below.
  const probes = [...new Set(suite.items.map((i) => i.probe))];
  const registeredDates = [...new Set(suite.items.map((i) => i.registeredAt))];
  const origins = [...new Set(suite.artifacts.map((a) => a.source.origin))];
  const oneProbe = probes.length === 1 ? probes[0] : undefined;
  const oneDate = registeredDates.length === 1 ? registeredDates[0] : undefined;
  const allPrivate = origins.length === 1 && origins[0] === "private";

  return (
    <main>
      <div className="ambient border-b hairline">
        <div className="mx-auto max-w-5xl px-6 pb-12 pt-14">
          <div className="flex items-center gap-3 rise">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">
              Launch suite
            </span>
            <span className="h-px flex-1 bg-rule" aria-hidden="true" />
            <span className="font-mono text-[11px] text-ink/45">
              suiteSpecHash {shortHash(suiteSpecHash(suite))}
            </span>
          </div>

          <h1 className="mt-6 font-mono text-4xl font-semibold tracking-[-0.035em] sm:text-5xl rise rise-2">
            {suite.id}
          </h1>
          {suite.docs !== undefined ? (
            <p
              className="mt-5 max-w-[68ch] text-[17px] leading-[1.55] text-ink/75 rise rise-2"
              style={{ fontFamily: "var(--font-editorial)" }}
            >
              {suite.docs}
            </p>
          ) : null}

          <dl className="mt-9 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4 rise rise-3">
            <Spec k="presentation" v={suite.presentation} mono />
            <Spec
              k="sampling"
              v={`k=${String(suite.sampling.k)} · t=${String(suite.sampling.temperature)} · ${String(suite.sampling.maxTokens)} tok`}
              mono
            />
            <Spec k="metrics" v={suite.metrics.join(", ")} />
            <Spec k="retired" v={String(retired.length)} mono />
          </dl>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-24">
        {/* ------------------------------------------- composition -------- */}
        <section className="mt-14" aria-labelledby="composition-heading">
          <h2 id="composition-heading" className="text-2xl font-semibold tracking-[-0.02em]">
            Composition
          </h2>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            A suite that only ever tests the happy path cannot tell you when it starts firing on everything.
            {oneProbe !== undefined ? ` Every item here is an ${oneProbe} probe` : ""}
            {oneDate !== undefined ? `, registered ${oneDate}` : ""}
            {oneProbe !== undefined || oneDate !== undefined ? "." : ""}
          </p>

          <div className="panel mt-6 p-6 sm:p-7">
            <div className="flex flex-wrap items-baseline gap-8">
              <div>
                <div className="font-mono text-5xl font-semibold leading-none tracking-[-0.04em] tabular-nums">
                  {active.length}
                </div>
                <div className="mt-2 text-[11px] uppercase tracking-[0.08em] text-ink/50">active items</div>
              </div>
              <div>
                <div className="font-mono text-5xl font-semibold leading-none tracking-[-0.04em] tabular-nums text-amber">
                  {negatives}
                </div>
                <div className="mt-2 text-[11px] uppercase tracking-[0.08em] text-ink/50">negative</div>
              </div>
              <div className="min-w-[220px] flex-1">
                <div className="meter">
                  <span className="meter-fill" style={{ width: `${String(negativePct)}%` }} />
                </div>
                <div className="mt-2 flex justify-between font-mono text-[11px] text-ink/50">
                  <span className="tabular-nums">{negativePct.toFixed(1)}% negative</span>
                  <span className={meetsNegativesQuota(suite) ? "text-ink/60" : "text-amber"}>
                    {meetsNegativesQuota(suite) ? "quota met" : "quota NOT met"}
                  </span>
                </div>
              </div>
            </div>

            {/* One tile per item: polarity is a shape before it is a word. */}
            <ul className="mt-8 flex flex-wrap gap-1.5">
              {suite.items.map((item) => {
                const isNeg = item.polarity === "negative";
                const isRetired = item.retired !== undefined;
                return (
                  <li
                    key={item.id}
                    className={`rounded-[4px] px-2 py-1 font-mono text-[11px] tabular-nums ${
                      isRetired
                        ? "bg-ink/5 text-ink/35 line-through"
                        : isNeg
                          ? "bg-amber/15 text-amber"
                          : "bg-ink/6 text-ink/65"
                    }`}
                    title={`${item.polarity}${isRetired ? " · retired" : ""}`}
                  >
                    {item.id}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 font-mono text-[11px] text-ink/45">
              amber = negative · quiet = positive
              {retired.length > 0 ? " · struck = retired" : ""}
            </p>
          </div>

          {retired.length > 0 ? (
            <ul className="mt-4 grid gap-3">
              {retired.map((item) => (
                <li key={item.id} className="well p-4 text-[14px] leading-relaxed text-ink/75">
                  <span className="font-mono text-[12.5px] text-ink">{item.id}</span> — retired{" "}
                  {item.retired?.at}: {item.retired?.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* --------------------------------------------- artifacts -------- */}
        <section className="mt-16" aria-labelledby="artifacts-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id="artifacts-heading" className="text-2xl font-semibold tracking-[-0.02em]">
              Artifacts
            </h2>
            <span className="font-mono text-xs tabular-nums text-ink/50">
              {suite.artifacts.length} probed
            </span>
          </div>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            {allPrivate
              ? "Every artifact below is private and vendored-only — the text probed is committed to this repo, but it is not independently re-verifiable against a public source. That is stated once here rather than repeated under each one."
              : "Provenance is stated per artifact: a public artifact names the repo and commit it was captured from; a private one is vendored-only and not independently re-verifiable."}
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suite.artifacts.map((artifact, i) => (
              <li
                key={artifact.id}
                className="panel panel-hover p-4 rise"
                style={{ animationDelay: `${String(i * 35)}ms` }}
              >
                <div className="font-mono text-[11px] text-ink/45">{artifact.id}</div>
                <div className="mt-1.5 text-[15px] font-semibold tracking-[-0.01em]">
                  {artifact.materialized.name}
                </div>
                <div className="mt-1 text-[12px] text-ink/55">{artifact.kind}</div>
                {artifact.source.origin === "public" ? (
                  <div className="mt-3 border-t hairline pt-2 font-mono text-[10.5px] text-ink/50">
                    {artifact.source.repo}@{artifact.source.commit.slice(0, 12)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
