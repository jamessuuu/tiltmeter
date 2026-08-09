/**
 * Build-time read of the committed mechanism diagram (scripts/diagram.mjs
 * output). Read as raw text and inlined into the page (never an `<img>`):
 * an inlined `<svg>` exposes its own `<title>`/`<desc>` to assistive tech
 * directly, which is what DESIGN-DIRECTION.md's accessibility section asks
 * for ("carry a real `<title>`/`<desc>`, not `aria-label=\"image\"`") — an
 * `<img>` would hide those elements behind an opaque `alt` attribute
 * instead. Path resolution mirrors lib/observatory.ts (`process.cwd()`,
 * reliably `apps/web` at `next build` time) rather than
 * `import.meta.dirname`, which does not survive webpack's server bundling
 * in this project (see lib/calibration.ts's comment for the full story).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadAttributionDiagramSvg(): string {
  const path = join(process.cwd(), "..", "..", "apps", "web", "public", "diagram", "attribution.svg");
  return readFileSync(path, "utf8");
}
