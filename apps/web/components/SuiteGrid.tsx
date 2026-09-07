import Link from "next/link";
import { activeItems, meetsNegativesQuota, suiteSpecHash, type Suite } from "tiltmeter";
import { shortHash } from "@/lib/instrument";

/**
 * The four launch suites (2026-09-07). Previously four identical grey
 * stanzas, each ending in the same sentence — "No readings for this suite
 * yet." — printed four times. The interesting fact about a suite before
 * any reading exists is its COMPOSITION: how many items, how many of them
 * are negatives (a suite that only tests the happy path cannot tell you
 * when it starts firing on everything), whether that clears the quota, and
 * the spec hash that pins it. All four were already computed and rendered
 * as a run-on grey line; here they are the content.
 */
export function SuiteGrid({ suites }: { suites: Suite[] }) {
  return (
    <div className="mt-8 grid gap-5 sm:grid-cols-2">
      {suites.map((suite, i) => {
        const active = activeItems(suite);
        const negatives = active.filter((item) => item.polarity === "negative").length;
        const negativePct = active.length > 0 ? (negatives / active.length) * 100 : 0;
        const quota = meetsNegativesQuota(suite);
        return (
          <section
            key={suite.id}
            className="panel panel-hover p-6 rise"
            style={{ animationDelay: `${String(i * 55)}ms` }}
            data-testid={`suite-${suite.id}`}
          >
            <h3 className="text-lg font-semibold tracking-[-0.015em]">
              <Link href={`/suites/${suite.id}`} prefetch={false} className="hover:text-amber">
                {suite.id}
              </Link>
            </h3>

            <div className="mt-4 flex items-baseline gap-6">
              <div>
                <div className="font-mono text-4xl font-semibold tabular-nums tracking-[-0.035em] leading-none">
                  {active.length}
                </div>
                <div className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-ink/50">
                  active items
                </div>
              </div>
              <div>
                <div className="font-mono text-4xl font-semibold tabular-nums tracking-[-0.035em] leading-none text-amber">
                  {negatives}
                </div>
                <div className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-ink/50">
                  negative
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="meter">
                <span className="meter-fill" style={{ width: `${String(negativePct)}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[11px] font-mono text-ink/50">
                <span className="tabular-nums">{negativePct.toFixed(1)}% negative</span>
                <span className={quota ? "text-ink/60" : "text-amber"}>
                  {quota ? "quota met" : "quota NOT met"}
                </span>
              </div>
            </div>

            <p className="mt-5 border-t hairline pt-3 font-mono text-[11px] text-ink/45">
              suiteSpecHash {shortHash(suiteSpecHash(suite))}
            </p>
          </section>
        );
      })}
    </div>
  );
}
