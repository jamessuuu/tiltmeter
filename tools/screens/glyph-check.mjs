/**
 * Finds characters the page renders that the VENDORED FONTS DO NOT COVER.
 *
 * Coverage comes from `font-coverage.json` — the union of the cmap of every
 * vendored woff2, read out of the font files themselves by
 * `tools/screens/font-coverage.py --emit`. There is no inference in this
 * gate at all.
 *
 * That is a correction. The first version of this file measured coverage in
 * the browser by comparing a character's advance width with the font first
 * in the stack against the fallback alone, and calling it covered when they
 * differed. That method has a false-negative mode: when the font's advance
 * happens to COINCIDE with the fallback's, a present glyph reads as absent.
 * It fired here — U+2014 em dash was reported missing from Archivo when the
 * cmap shows it present in all three faces — and it produced a wrong
 * downstream claim (that the files were subset more tightly than
 * substrate.css declares; they are not, the declared range and the cmap
 * agree on every character tested).
 *
 * Controls did not catch it and could not: proving a method separates a
 * definitely-present glyph from a definitely-absent one says nothing about
 * a coincidental advance match on some third character. The lesson is
 * narrower than "add more controls" — when ground truth is readable, read
 * it instead of inferring, and the whole error class disappears.
 *
 *   GLYPH_BASE=http://127.0.0.1:PORT node tools/screens/glyph-check.mjs
 *
 * NOTE when falsifying this gate: run it directly, never `node x.mjs | tail`
 * — a pipeline reports the LAST command's exit code, so a real failure
 * looks like a pass.
 */
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.GLYPH_BASE;
if (!BASE) throw new Error("set GLYPH_BASE");

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "font-coverage.json"), "utf8"),
);
const COVERED = new Set(manifest.codePoints);

// The manifest must be able to answer both ways, or it is not being read.
if (!COVERED.has(0x41) || COVERED.has(0x27ff)) {
  console.error("font-coverage.json failed its own sanity check (A present, U+27FF absent). Regenerate it.");
  process.exit(2);
}

const ROUTES = [
  "/",
  "/methodology/",
  "/models/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

/**
 * Uncovered characters that may still ship as TEXT, because they sit inline
 * inside a sentence: they are read, selected and copied, every default
 * platform font has them, and converting them to SVG would break selection,
 * copy-paste and screen-reader order.
 *
 * A DECORATIVE mark — one whose ELEMENT contains nothing else, doing an
 * icon's job — is never allowlistable. It has no semantic role to preserve
 * and carries the real tofu risk, so it becomes an inline SVG.
 */
const ALLOWED = new Map([
  [0x2192, "right arrow → follows link text inline and joins hashes in the chain; universal platform coverage; SVG would break selection"],
]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const findings = new Map();

for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  const chars = await page.evaluate(() => {
    // Non-rendered containers hold text that never reaches a visitor —
    // notably Next.js's inlined RSC payload, which serializes the page's own
    // strings into a <script> and doubles every count for a checker that
    // walks all of <body>. Filtered by TAG and by computed display, never by
    // box size: content inside a collapsed <details> measures zero and
    // renders the instant someone opens it, which is exactly where a
    // decorative marker tends to live.
    const NON_RENDERED = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);
    const seen = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) !== null) {
      const el = node.parentElement;
      if (el === null || NON_RENDERED.has(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const elText = (el.textContent ?? "").trim();
      for (const ch of node.nodeValue ?? "") {
        const cp = ch.codePointAt(0);
        if (cp === undefined || cp < 128) continue;
        const prev = seen.get(ch) ?? { ch, cp, count: 0, families: new Set(), standalone: false };
        prev.count++;
        prev.families.add(cs.fontFamily.split(",")[0].replace(/["']/g, "").trim());
        // Decorative = the character is the ENTIRE text of its ELEMENT.
        // Not "of its text node": JSX splits `{a} — {b}`, so the em dash in
        // "The identical plan — 12 cells" lands alone in a text node while
        // plainly being prose.
        if (elText === ch) prev.standalone = true;
        seen.set(ch, prev);
      }
    }
    return [...seen.values()].map((v) => ({ ...v, families: [...v.families] }));
  });

  for (const c of chars) {
    if (COVERED.has(c.cp)) continue;
    const existing = findings.get(c.ch) ?? { ...c, count: 0, routes: [] };
    existing.count += c.count;
    existing.standalone = existing.standalone || c.standalone;
    existing.routes.push(route);
    findings.set(c.ch, existing);
  }
}

await browser.close();

console.log("=== coverage source ===");
console.log(`  font-coverage.json — ${String(manifest.codePoints.length)} code points, union of:`);
for (const [name, n] of Object.entries(manifest.fonts)) console.log(`    ${name}: ${String(n)}`);

console.log("\n=== rendered characters NOT in any vendored font ===");
let blocking = 0;
if (findings.size === 0) console.log("  none");
for (const f of [...findings.values()].sort((a, b) => b.count - a.count)) {
  const reason = ALLOWED.get(f.cp);
  const ok = reason !== undefined && !f.standalone;
  if (!ok) blocking++;
  const code = `U+${f.cp.toString(16).toUpperCase().padStart(4, "0")}`;
  console.log(
    `  ${ok ? "allow " : "BLOCK "} ${code} ${f.ch}  x${String(f.count).padStart(3)}  ${f.standalone ? "STANDALONE(decorative)" : "inline"}  [${f.families.join("/")}]  ${f.routes.join(" ")}`,
  );
  if (ok) console.log(`           reason: ${reason}`);
  else if (f.standalone) console.log("           a standalone decorative mark must be an inline SVG, not a font glyph");
  else console.log("           not covered by any vendored font and not allowlisted");
}

console.log(`\n${String(blocking)} blocking`);
process.exit(blocking > 0 ? 1 : 0);
