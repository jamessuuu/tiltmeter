/**
 * Finds characters the page renders that the VENDORED FONTS DO NOT COVER,
 * by measuring in a real browser rather than by reasoning about a declared
 * unicode-range.
 *
 * Why measurement and not the declared range: this project's @font-face
 * blocks do not declare `unicode-range` at all. The risk is still real —
 * the woff2 files are subset to the Google Fonts latin range, so a glyph
 * outside it simply is not in the font and the browser falls through to a
 * system face per character. Same visible outcome, different mechanism, and
 * a checker built around parsing a range that isn't there would report a
 * clean pass forever. So coverage is probed directly.
 *
 * Method: for each distinct character actually rendered, measure its advance
 * width on a canvas with the target font first in the stack, then with only
 * the fallback. A covered glyph in a mono face measures differently from the
 * fallback; an uncovered one measures identically because it IS the
 * fallback. Two controls run every time so the probe is proven to
 * discriminate before its verdict is believed:
 *   - "A"      MUST come back covered
 *   - U+27FF ⟿ MUST come back uncovered (well outside latin)
 * If either control misbehaves the script exits non-zero and reports
 * nothing, because a probe that cannot tell the two apart is worse than no
 * probe.
 *
 *   GLYPH_BASE=http://127.0.0.1:PORT node tools/screens/glyph-check.mjs
 *
 * NOTE when falsifying this gate: run it directly, never `node x.mjs | tail`
 * — a pipeline reports the LAST command's exit code, so a real failure
 * looks like a pass.
 */
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";

const BASE = process.env.GLYPH_BASE;
if (!BASE) throw new Error("set GLYPH_BASE");

const ROUTES = [
  "/",
  "/methodology/",
  "/models/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

/**
 * Prose punctuation that is allowed to fall back to a system face: it sits
 * inline inside a sentence, is covered by every default font on every
 * platform, and turning it into an SVG would break text selection,
 * copy-paste and screen-reader reading order.
 *
 * A DECORATIVE mark is NOT allowlistable here. A character that is its own
 * text node, doing an icon's job, must be an inline SVG — it has no
 * semantic role to preserve and it carries the real tofu risk.
 */
const ALLOWED = new Map([
  ["\u2014", "em dash — inline prose punctuation, universal coverage"],
  ["\u2013", "en dash – inline prose punctuation, universal coverage"],
  ["\u2192", "right arrow → follows link text inline; universal coverage; SVG would break selection"],
  ["\u2019", "right single quote ’ inline prose punctuation, universal coverage"],
  ["\u201C", "left double quote “ inline prose punctuation, universal coverage"],
  ["\u201D", "right double quote ” inline prose punctuation, universal coverage"],
  ["\u00B7", "middle dot · inline separator, universal coverage"],
  ["\u00A0", "non-breaking space"],
  ["\u2264", "less-than-or-equal ≤ inline in a stated bar"],
  ["\u2265", "greater-than-or-equal ≥ inline in a stated bar"],
  ["\u00A7", "section sign § inline in spec references"],
  ["\u2212", "minus sign − inline in numeric prose"],
]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const findings = new Map();
let controlsOk = null;

for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.fonts.ready);

  const result = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d");
    if (g === null) throw new Error("no 2d context");

    /** Does `font` supply a glyph for `ch`, or is this the fallback showing through? */
    const covered = (ch, font, fallback) => {
      g.font = `32px ${fallback}`;
      const bare = g.measureText(ch).width;
      g.font = `32px ${font}, ${fallback}`;
      const withFont = g.measureText(ch).width;
      return withFont !== bare;
    };

    // Controls: prove the probe discriminates before trusting its verdicts.
    const controls = {
      coveredControl: covered("A", '"Commit Mono"', "monospace"),
      uncoveredControl: covered("\u27FF", '"Commit Mono"', "monospace"),
    };

    // Every distinct non-ASCII character actually rendered, with the family
    // its element resolves to and whether it stands alone in its text node.
    const seen = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) !== null) {
      const el = node.parentElement;
      if (el === null) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const raw = node.nodeValue ?? "";
      for (const ch of raw) {
        if (ch.codePointAt(0) < 128) continue;
        const family = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
        const key = ch;
        const prev = seen.get(key) ?? { ch, count: 0, families: new Set(), standalone: false };
        prev.count++;
        prev.families.add(family);
        // "Standalone" = the character is the ENTIRE text of its ELEMENT,
        // not merely of its text node. JSX splits `{a} — {b}` into separate
        // text nodes, so the node-level test wrongly flagged an em dash
        // sitting inside "The identical plan — 12 cells" as decorative.
        if ((el.textContent ?? "").trim() === ch) prev.standalone = true;
        seen.set(key, prev);
      }
    }

    const out = [];
    for (const v of seen.values()) {
      const family = [...v.families][0] ?? "monospace";
      const isCovered = covered(v.ch, `"${family}"`, family.includes("Commit") ? "monospace" : "sans-serif");
      out.push({
        ch: v.ch,
        code: `U+${v.ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
        count: v.count,
        families: [...v.families],
        standalone: v.standalone,
        covered: isCovered,
      });
    }
    return { controls, chars: out };
  });

  if (controlsOk === null) controlsOk = result.controls;

  for (const c of result.chars) {
    if (c.covered) continue;
    const existing = findings.get(c.ch) ?? { ...c, count: 0, routes: [] };
    existing.count += c.count;
    existing.standalone = existing.standalone || c.standalone;
    existing.routes.push(route);
    findings.set(c.ch, existing);
  }
}

await browser.close();

console.log("=== controls ===");
console.log(`  "A"      covered by Commit Mono : ${String(controlsOk?.coveredControl)}   (must be true)`);
console.log(`  U+27FF   covered by Commit Mono : ${String(controlsOk?.uncoveredControl)}  (must be false)`);
if (controlsOk?.coveredControl !== true || controlsOk.uncoveredControl !== false) {
  console.error("\nPROBE CANNOT DISCRIMINATE — refusing to report. Fix the probe before believing any verdict.");
  process.exit(2);
}

console.log("\n=== characters NOT covered by the vendored fonts ===");
let blocking = 0;
if (findings.size === 0) {
  console.log("  none");
}
for (const f of [...findings.values()].sort((a, b) => b.count - a.count)) {
  const reason = ALLOWED.get(f.ch);
  // A decorative mark is never allowlistable, even if the character also
  // appears as prose punctuation elsewhere.
  const ok = reason !== undefined && !f.standalone;
  if (!ok) blocking++;
  console.log(
    `  ${ok ? "allow " : "BLOCK "} ${f.code} ${f.ch}  x${String(f.count).padStart(3)}  ${f.standalone ? "STANDALONE(decorative)" : "inline"}  [${f.families.join("/")}]  ${f.routes.join(" ")}`,
  );
  if (ok) console.log(`           reason: ${reason}`);
  else if (f.standalone) console.log("           a standalone decorative mark must be an inline SVG, not a font glyph");
}

console.log(`\n${String(blocking)} blocking`);
process.exit(blocking > 0 ? 1 : 0);
