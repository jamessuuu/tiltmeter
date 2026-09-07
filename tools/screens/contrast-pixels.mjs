/**
 * Contrast measured from RENDERED PIXELS, which is the only version of this
 * check with no blind spot left.
 *
 * Three successive methods, each fixing the last one's hole:
 *
 *  1. Parse the colour strings. Broke on `oklab()` and dropped alpha —
 *     reported a clean pass on a page with 109 failures.
 *  2. Composite the declared colours on a canvas (contrast-check.mjs). Fixes
 *     parsing and alpha, but only sees `background-color` on the ancestor
 *     chain. It cannot see a gradient, and — the hole nobody flagged — it
 *     cannot see a PSEUDO-ELEMENT background either. This site's ambient
 *     wash is `.ambient::before`, so `getComputedStyle(el).backgroundImage`
 *     reads "none" on the element itself and the hero text was being scored
 *     against flat paper rather than paper-plus-wash.
 *  3. This: render the page, then render it again with every glyph made
 *     transparent, and sample the actual background pixel underneath each
 *     text run. Gradients, images, pseudo-elements, blend modes and nested
 *     alpha all resolve for free, because the browser has already drawn
 *     them.
 *
 * A gradient is not excused, it is sampled — several points across the run,
 * scored at the WORST one. "My instrument cannot measure this" is not "this
 * is fine"; it only relocates the question.
 *
 *   PIXEL_BASE=http://127.0.0.1:PORT node tools/screens/contrast-pixels.mjs
 */
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";
import sharp from "sharp";

const BASE = process.env.PIXEL_BASE;
if (!BASE) throw new Error("set PIXEL_BASE");

const ROUTES = [
  "/",
  "/methodology/",
  "/models/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

const f = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = (r, g, b) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let total = 0;
let worstOverall = { ratio: 99, text: "" };

for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  // Every text run, with its box, resolved colour and required ratio.
  const runs = await page.evaluate(() => {
    const NON_RENDERED = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    const out = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (NON_RENDERED.has(el.tagName)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue ?? "").join("").trim();
      if (own.length === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      // Resolve the text colour through the browser (handles any colour space).
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 1, 1);
      g.fillStyle = cs.color;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      const px = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      out.push({
        text: own.slice(0, 40),
        color: [d[0], d[1], d[2]],
        colorCss: cs.color,
        px,
        required: px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5,
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
      });
    }
    return out;
  });

  // Second render with the glyphs gone, so what remains is pure background.
  await page.addStyleTag({ content: "*, *::before, *::after { color: transparent !important; }" });
  await page.waitForTimeout(200);
  const shot = await page.screenshot({ type: "png" });
  // sharp decodes to raw RGB(A); the browser has already done all the
  // compositing, so these bytes ARE the ground truth.
  const { data: px, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;

  const sample = (x, y) => {
    const xi = Math.max(0, Math.min(info.width - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(info.height - 1, Math.round(y)));
    const i = (info.width * yi + xi) * ch;
    return lum(px[i], px[i + 1], px[i + 2]);
  };

  const failures = [];
  for (const run of runs) {
    const fgL = lum(run.color[0], run.color[1], run.color[2]);
    // Several points across the run; a gradient is scored at its WORST.
    let worst = Infinity;
    for (let t = 0.1; t <= 0.9; t += 0.2) {
      const x = run.box.x + run.box.w * t;
      const y = run.box.y + run.box.h / 2;
      worst = Math.min(worst, ratio(fgL, sample(x, y)));
    }
    if (worst < worstOverall.ratio) worstOverall = { ratio: worst, text: run.text };
    if (worst < run.required) {
      failures.push(`${worst.toFixed(2)}:1 (need ${run.required}) ${run.px}px "${run.text}" ${run.colorCss}`);
    }
  }
  total += failures.length;
  console.log(`${route.padEnd(34)} ${String(failures.length).padStart(3)} failing  (${String(runs.length)} runs sampled)`);
  for (const x of failures.slice(0, 6)) console.log(`     ${x}`);
}

await browser.close();
console.log(`\nTOTAL ${String(total)} failures. Tightest passing ratio anywhere: ${worstOverall.ratio.toFixed(2)}:1 ("${worstOverall.text}")`);
process.exit(total > 0 ? 1 : 0);
