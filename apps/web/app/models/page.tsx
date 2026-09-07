import type { Metadata } from "next";
import { loadAllReadings, loadModels, loadPanel } from "@/lib/observatory";

export const dynamic = "error";

export const metadata: Metadata = { title: "Models" };

/**
 * SPEC §10/§13: "panel entries, releasedAt with cited source, resolved
 * snapshot ids, substitutions. NO ranking, no scores, no leaderboard — the
 * death-condition guard." This page renders panel/model METADATA ONLY —
 * no metric, no score, no sort-by-performance, ever. `e2e/models.spec.ts`
 * asserts this structurally: the four column headers are fixed, the row
 * order is the panel's declaration order, and NO numeric metric value (a
 * percentage, or a bare 0.xx) may appear anywhere in the body text. That
 * last rule is why this page carries no counts and no rates — the
 * constraint is the feature, so nothing below may quietly reintroduce one.
 *
 * Surfaced 2026-09-07: the refusal IS this page's content, and it was
 * buried in a grey paragraph above a bare table floating in half a screen
 * of empty paper. It now leads.
 */
export default function ModelsPage() {
  const panel = loadPanel();
  const models = loadModels();
  // A substitution is a reading whose RESOLVED model id differs from the id
  // the panel asked for — that is the actual signal, not a status enum value
  // (there is no "substituted" status; TypeScript caught that assumption).
  // Deliberately a boolean, never a count rendered to the page:
  // e2e/models.spec.ts forbids any numeric metric value in the body text.
  const requestedByCell = new Map(panel.entries.map((e) => [e.cellId, e.modelIdRequested]));
  const anySubstitution = loadAllReadings().some(
    (r) => r.axes.modelIdResolved !== requestedByCell.get(r.cellId),
  );

  return (
    <main>
      <div className="ambient border-b hairline">
        <div className="mx-auto max-w-5xl px-6 pb-12 pt-14">
          <div className="flex items-center gap-3 rise">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/70">
              The panel
            </span>
            <span className="h-px flex-1 bg-rule" aria-hidden="true" />
            <span className="font-mono text-[11px] text-ink/65">death-condition guard</span>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl rise rise-2">Models</h1>
          <p
            className="mt-5 max-w-[60ch] text-[19px] leading-[1.5] text-ink/80 rise rise-2"
            style={{ fontFamily: "var(--font-editorial)" }}
          >
            This page is deliberately <em>not</em> a leaderboard. No score, no rank, and no cross-suite
            aggregate exists anywhere in this project — not hidden, not computed and withheld. There is
            nothing to sort by.
          </p>
          <p className="mt-4 max-w-[66ch] text-[15px] leading-relaxed text-ink/65 rise rise-3">
            Every published number is scoped to (suite, harness commit, model). A model is not good or bad
            here; a harness either still fires the way it did last week, or it does not. See each suite&apos;s
            own page for readings.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-24">
        <div className="panel mt-12 overflow-hidden" data-surface="flat">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              The panel this project runs against: model, its role, its cited release date, and the source
            </caption>
            <thead>
              <tr className="border-b hairline">
                <th
                  scope="col"
                  className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink/70"
                >
                  Model
                </th>
                <th
                  scope="col"
                  className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink/70"
                >
                  Panel role
                </th>
                <th
                  scope="col"
                  className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink/70"
                >
                  Released
                </th>
                <th
                  scope="col"
                  className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink/70"
                >
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {panel.entries.map((entry, i) => {
                const model = models.models.find((m) => m.modelId === entry.modelIdRequested);
                return (
                  <tr key={entry.cellId} className={i > 0 ? "border-t hairline" : ""}>
                    <td className="px-5 py-4 align-middle text-[15px] font-semibold tracking-[-0.01em]">
                      {model?.displayName ?? entry.modelIdRequested}
                    </td>
                    <td className="px-5 py-4 align-middle">
                      <span
                        className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${
                          entry.role === "null"
                            ? "text-amber ring-1 ring-amber/40"
                            : "bg-ink/6 text-ink/70"
                        }`}
                      >
                        {entry.role}
                      </span>
                    </td>
                    <td className="px-5 py-4 align-middle font-mono text-[13px] tabular-nums text-ink/70">
                      {model?.releasedAt ?? "—"}
                    </td>
                    <td className="px-5 py-4 align-middle">
                      {model !== undefined ? (
                        <a
                          href={model.sourceUrl}
                          className="inline-flex items-center py-1 text-[13.5px] underline decoration-rule underline-offset-4 hover:text-amber"
                        >
                          cited source
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="well p-5">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-ink/70">
              The null role
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink/70">
              One panel entry runs the cheapest model a second time with identical axes. Nothing about the
              model or the harness differs between the pair, so whatever moves between them is noise — the
              negative control that bounds what &quot;moved&quot; is allowed to mean.
            </p>
          </div>
          <div className="well p-5">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.09em] text-ink/70">
              Alias substitution
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink/70">
              {anySubstitution
                ? "A model has been resolved via alias substitution in this observatory. It is published here as a labelled entry, never a silent swap (SPEC §4)."
                : "No model has ever been resolved via alias substitution in this observatory. When it happens it publishes here as a labelled entry, never a silent swap (SPEC §4)."}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
