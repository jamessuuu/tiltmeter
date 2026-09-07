/**
 * Counts elements that still move under prefers-reduced-motion, on every
 * route, by RENDERING them — a diff cannot tell you this, because Tailwind's
 * transition-* utilities emit their transition-property/duration pair
 * unconditionally and are not wrapped in the media query, so a global
 * @media (prefers-reduced-motion: reduce) block does not reach them unless
 * it is written to override the utility.
 *
 * Perceptibility floor is 20ms: the 0.001s idiom is deliberate (it keeps
 * transitionend/animationend handlers firing instead of hanging) and must
 * not be counted as surviving motion.
 *
 *   PROBE_BASE=http://127.0.0.1:PORT node tools/screens/motion-probe.mjs
 */
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";

const BASE = process.env.PROBE_BASE;
if (!BASE) throw new Error("set PROBE_BASE");

const ROUTES = [
  "/",
  "/methodology/",
  "/models/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

const FLOOR = 0.02; // seconds

const browser = await chromium.launch();
let survivingTotal = 0;

for (const reduce of [false, true]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: reduce ? "reduce" : "no-preference",
  });
  const page = await ctx.newPage();
  console.log(`\n=== prefers-reduced-motion: ${reduce ? "reduce" : "no-preference"} ===`);
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const r = await page.evaluate((floor) => {
      const longest = (v) =>
        Math.max(...String(v).split(",").map((p) => {
          const t = p.trim();
          const n = parseFloat(t);
          if (Number.isNaN(n)) return 0;
          return t.endsWith("ms") ? n / 1000 : n;
        }), 0);
      const out = [];
      let transitions = 0;
      let animations = 0;
      for (const el of document.body.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        const td = longest(cs.transitionDuration);
        const ad = longest(cs.animationDuration);
        if (td >= floor) transitions++;
        if (ad >= floor && cs.animationName !== "none") animations++;
        if (td >= floor || (ad >= floor && cs.animationName !== "none")) {
          if (out.length < 6) {
            out.push(
              `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 44)} [t=${td}s a=${ad}s ${cs.animationName}]`,
            );
          }
        }
      }
      return { transitions, animations, sample: out };
    }, FLOOR);
    const moving = r.transitions + r.animations;
    if (reduce) survivingTotal += moving;
    console.log(
      `  ${route.padEnd(34)} transitions=${String(r.transitions).padStart(3)} animating=${String(r.animations).padStart(3)}` +
        (reduce && moving > 0 ? "   <<< MOTION SURVIVES" : ""),
    );
    if (reduce && moving > 0) for (const sline of r.sample) console.log(`        ${sline}`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\nTOTAL surviving motion under reduce: ${String(survivingTotal)}`);
if (survivingTotal > 0) process.exitCode = 1;
