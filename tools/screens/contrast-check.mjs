/**
 * WCAG 1.4.3 contrast, measured by letting the BROWSER composite the colours
 * rather than by parsing colour strings.
 *
 * Colour-string parsing is where every contrast checker in this session went
 * wrong. One handled oklch() but not oklab(), fell through to a generic
 * number grab, read `oklab(0.206 0.0017 0.0105 / 0.4)` as r/g/b, and
 * reported a confident clean pass on a page with 22 failures. It also
 * dropped the alpha. Two independent parse errors, one wrong verdict.
 *
 * So nothing here parses a colour. Every value is painted onto a canvas and
 * read back as a pixel, which means the browser's own colour engine does the
 * work: any colour space it supports is handled, alpha composites correctly
 * by construction, and there is no format this can silently misread.
 *
 * Backgrounds are resolved by painting the ancestor chain root-down, so a
 * translucent panel over a translucent panel over paper comes out right.
 *
 * KNOWN LIMIT, reported rather than hidden: an element whose background is a
 * gradient or image cannot be reduced to one colour. Those are counted
 * separately as UNMEASURABLE, never as failures. A sibling tool reported a
 * perfectly legible dark-on-yellow-gradient button at 1.19:1 by reading only
 * background-color, and a false failure costs as much trust as a false pass.
 *
 * Self-validating: fixtures with known ratios run first, in both directions,
 * and the script refuses to report anything if they do not come out right.
 *
 *   CONTRAST_BASE=http://127.0.0.1:PORT node tools/screens/contrast-check.mjs
 */
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";

const BASE = process.env.CONTRAST_BASE;
if (!BASE) throw new Error("set CONTRAST_BASE");

const ROUTES = [
  "/",
  "/methodology/",
  "/models/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

const probe = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (g === null) throw new Error("no 2d context");

  /** Paint a stack of CSS colours bottom-up on opaque white; return the resulting sRGB pixel. */
  const composite = (layers) => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 1, 1);
    for (const c of layers) {
      if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") continue;
      g.fillStyle = c;
      g.fillRect(0, 0, 1, 1);
    }
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };

  const lum = ([r, gr, b]) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(gr) + 0.0722 * f(b);
  };

  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  // ---- fixtures: the probe must get known values right, both ways --------
  const black = composite(["#000000"]);
  const white = composite(["#ffffff"]);
  const mid = composite(["#767676"]); // the canonical 4.54:1 grey on white
  const fixtures = {
    blackOnWhite: ratio(black, white), // 21
    greyOnWhite: ratio(mid, white), // ~4.54
    // Alpha must actually composite: 40% black over white lands on #999999,
    // which is 2.849:1 — computed independently, not eyeballed. My first
    // expected value here was wrong (3.66) and the fixture caught ME rather
    // than the page, which is the entire reason it runs first.
    alpha40: ratio(composite(["#ffffff", "rgba(0,0,0,0.4)"]), white), // 2.849
    // and the browser must handle oklab, the format that broke the other tool
    oklabParsed: ratio(composite(["#ffffff", "oklab(0.206299 0.00176432 0.0105445 / 0.4)"]), white),
  };

  // ---- walk the page -----------------------------------------------------
  const NON_RENDERED = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);
  const results = [];
  const seen = new Set();

  for (const el of document.body.querySelectorAll("*")) {
    if (NON_RENDERED.has(el.tagName)) continue;
    // Only elements with their OWN visible text.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.nodeValue ?? "")
      .join("")
      .trim();
    if (own.length === 0) continue;

    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // Background: ancestor chain, root-down, so translucency composites.
    const chain = [];
    let gradient = false;
    for (let n = el; n !== null; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (ncs.backgroundImage !== "none") gradient = true;
      chain.push(ncs.backgroundColor);
    }
    chain.reverse();

    const bg = composite(chain);
    const fg = composite([...chain, cs.color]);
    const r = ratio(fg, bg);

    const px = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;

    const key = `${own.slice(0, 40)}|${cs.color}|${String(px)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (r < required) {
      results.push({
        text: own.slice(0, 46),
        ratio: Math.round(r * 100) / 100,
        required,
        px,
        color: cs.color,
        gradient,
        tag: el.tagName.toLowerCase(),
      });
    }
  }
  return { fixtures, results };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let validated = false;
let failures = 0;
let unmeasurable = 0;

for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const { fixtures, results } = await page.evaluate(probe);

  if (!validated) {
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const ok =
      near(fixtures.blackOnWhite, 21, 0.1) &&
      near(fixtures.greyOnWhite, 4.54, 0.15) &&
      near(fixtures.alpha40, 2.849, 0.05) &&
      fixtures.oklabParsed > 2 &&
      fixtures.oklabParsed < 3.5;
    console.log("=== fixtures (probe must get these right before reporting) ===");
    console.log(`  #000 on #fff        ${fixtures.blackOnWhite.toFixed(2)}  expect 21`);
    console.log(`  #767676 on #fff     ${fixtures.greyOnWhite.toFixed(2)}  expect ~4.54`);
    console.log(`  40% black on #fff   ${fixtures.alpha40.toFixed(2)}  expect 2.85 (alpha composites)`);
    console.log(`  oklab(..)/0.4       ${fixtures.oklabParsed.toFixed(2)}  expect 2-3.5 (oklab + alpha parsed)`);
    if (!ok) {
      console.error("\nFIXTURES FAILED — refusing to report. The probe is wrong, not the page.");
      await browser.close();
      process.exit(2);
    }
    console.log("  -> probe validated\n");
    validated = true;
  }

  const real = results.filter((r) => !r.gradient);
  const grad = results.filter((r) => r.gradient);
  failures += real.length;
  unmeasurable += grad.length;

  console.log(`${route}  ${String(real.length)} failing, ${String(grad.length)} unmeasurable (gradient)`);
  for (const f of real.sort((a, b) => a.ratio - b.ratio).slice(0, 8)) {
    console.log(
      `   ${f.ratio.toFixed(2)}:1  need ${String(f.required)}  ${String(f.px)}px  "${f.text}"  ${f.color}`,
    );
  }
}

await browser.close();
console.log(`\nTOTAL: ${String(failures)} WCAG 1.4.3 failures, ${String(unmeasurable)} unmeasurable behind gradients`);
process.exit(failures > 0 ? 1 : 0);
