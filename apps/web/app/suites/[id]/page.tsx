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

/** SPEC §10: "items including retired ones with retirement reasons, artifact provenance levels, registration dates, current suiteSpecHash." */
export default async function SuitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ids = listSuiteIds();
  if (!ids.includes(id)) notFound();
  const suite = loadSuite(id);
  const active = activeItems(suite);
  const retired = suite.items.filter((i) => i.retired !== undefined);
  const negatives = active.filter((i) => i.polarity === "negative").length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{suite.id}</h1>
      {suite.docs !== undefined ? <p className="mt-2 text-ink/70 max-w-prose">{suite.docs}</p> : null}

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm max-w-md">
        <dt className="text-ink/60">Presentation</dt>
        <dd>{suite.presentation}</dd>
        <dt className="text-ink/60">Sampling</dt>
        <dd>
          k={suite.sampling.k}, t={suite.sampling.temperature}, maxTokens={suite.sampling.maxTokens}
        </dd>
        <dt className="text-ink/60">Metrics</dt>
        <dd>{suite.metrics.join(", ")}</dd>
        <dt className="text-ink/60">Active items</dt>
        <dd>
          {active.length} ({negatives} negative — {meetsNegativesQuota(suite) ? "quota met" : "quota NOT met"})
        </dd>
        <dt className="text-ink/60">Retired items</dt>
        <dd>{retired.length}</dd>
        <dt className="text-ink/60">Current suiteSpecHash</dt>
        <dd className="font-mono">{shortHash(suiteSpecHash(suite))}</dd>
      </dl>

      <h2 className="mt-10 font-semibold">Artifacts</h2>
      <ul className="mt-3 space-y-3 text-sm">
        {suite.artifacts.map((artifact) => (
          <li key={artifact.id} className="border hairline p-3">
            <div className="font-mono text-xs text-ink/60">{artifact.id}</div>
            <div className="mt-1">
              {artifact.kind} — <strong>{artifact.materialized.name}</strong>
            </div>
            <div className="mt-1 text-xs text-ink/60">
              provenance: {artifact.source.origin}
              {artifact.source.origin === "public" ? (
                <>
                  {" "}
                  ({artifact.source.repo}@{artifact.source.commit.slice(0, 12)})
                </>
              ) : (
                " (vendored-only — not independently re-verifiable)"
              )}
            </div>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 font-semibold">Items</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {suite.items.map((item) => (
          <li key={item.id} className="border-b hairline pb-2">
            <span className="font-mono text-xs text-ink/60">{item.id}</span> — {item.polarity}, {item.probe}
            , registered {item.registeredAt}
            {item.retired !== undefined ? (
              <span className="text-amber">
                {" "}
                — RETIRED {item.retired.at}: {item.retired.reason}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
