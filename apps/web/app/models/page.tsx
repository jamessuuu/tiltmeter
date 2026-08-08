import type { Metadata } from "next";
import { loadModels, loadPanel } from "@/lib/observatory";

export const dynamic = "error";

export const metadata: Metadata = { title: "Models" };

/**
 * SPEC §10/§13: "panel entries, releasedAt with cited source, resolved
 * snapshot ids, substitutions. NO ranking, no scores, no leaderboard — the
 * death-condition guard." This page renders panel/model METADATA ONLY —
 * no metric, no score, no sort-by-performance, ever. `e2e/models.spec.ts`
 * asserts this structurally (no numeric score anywhere on the page).
 */
export default function ModelsPage() {
  const panel = loadPanel();
  const models = loadModels();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
      <p className="mt-2 text-ink/70 max-w-prose">
        The panel tiltmeter's suites run against. This page is deliberately NOT a leaderboard — no score, no
        rank, no cross-suite aggregate exists anywhere in this project (SPEC §1/§13's death condition). Every
        published number is scoped to (suite, harness commit, model); see each suite's own page for readings.
      </p>

      <table className="mt-8 w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b hairline">
            <th className="pr-4 py-2 font-medium">Model</th>
            <th className="pr-4 py-2 font-medium">Panel role</th>
            <th className="pr-4 py-2 font-medium">Released</th>
            <th className="pr-4 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {panel.entries.map((entry) => {
            const model = models.models.find((m) => m.modelId === entry.modelIdRequested);
            return (
              <tr key={entry.cellId} className="border-b hairline">
                <td className="pr-4 py-2">{model?.displayName ?? entry.modelIdRequested}</td>
                <td className="pr-4 py-2">{entry.role}</td>
                <td className="pr-4 py-2">{model?.releasedAt ?? "—"}</td>
                <td className="pr-4 py-2">
                  {model !== undefined ? (
                    <a href={model.sourceUrl} className="underline hover:text-amber">
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

      <p className="mt-6 text-xs text-ink/50">
        No model has ever been resolved via alias substitution in this observatory yet — that event, when it
        happens, publishes here as a labelled entry, never a silent swap (SPEC §4).
      </p>
    </main>
  );
}
