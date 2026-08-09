import { loadAttributionDiagramSvg } from "@/lib/diagram";

/**
 * DESIGN-DIRECTION.md's one diagram for tiltmeter: the axis tuple. Inlined
 * as real `<svg>` markup (not an `<img>`) so its own `<title>`/`<desc>`
 * (scripts/diagram.mjs) are exposed to assistive tech directly, plus a
 * visible, adjacent `<figcaption>` — the accessibility section's
 * "carry a real `<title>`/`<desc>`, not `aria-label=\"image\"`" read
 * literally. Server Component: the SVG is committed, static, and read once
 * at build time (lib/diagram.ts), so there is no client JS cost to this at
 * all.
 */
export function AttributionDiagram() {
  const svg = loadAttributionDiagramSvg();
  return (
    <figure className="mt-4" data-testid="attribution-diagram">
      {/* Committed, build-time-only SVG (scripts/diagram.mjs output) — never user input. */}
      <div className="border hairline p-4 bg-white/40 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="mt-2 text-xs text-ink/60 max-w-prose">
        Two readings compared on the five-element axis tuple (suite, model, runner, presentation, sampling).
        Change exactly one and the comparison resolves to a verdict. Change two — a suite edit landing in the
        same window as a model release, the one case an operator actually has to untangle — and the comparison
        refuses to resolve: <code>cannot-attribute</code>, published with the axes named, never guessed.
      </figcaption>
    </figure>
  );
}
