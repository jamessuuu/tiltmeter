import { test, expect } from "@playwright/test";

/**
 * WCAG 1.4.3 contrast, on every route.
 *
 * This dimension was unmeasured across the whole portfolio: project-gate's
 * accessibility coverage is img-alt, button-names and target-size only, with
 * no contrast check at all. tiltmeter had 109 failures across six routes
 * when someone finally looked — every one of them a Tailwind alpha modifier
 * (`text-ink/40` and friends) compositing to as little as 2.54:1 against the
 * warm paper ground, well under the 4.5:1 floor.
 *
 * Nothing here PARSES a colour, which is where the checkers that missed this
 * went wrong: one handled `oklch()` but not `oklab()`, fell through to a
 * generic number grab, read the three oklab components as r/g/b, dropped the
 * `/ 0.4` alpha, and reported a confident clean pass. Instead every colour is
 * painted onto a canvas and read back as a pixel, so the browser's own colour
 * engine does the parsing and compositing: any colour space it supports works,
 * and alpha is handled by construction.
 *
 * Backgrounds resolve through the ancestor chain, painted root-down, so a
 * translucent panel over a translucent panel over paper composites correctly.
 *
 * KNOWN LIMIT, reported rather than hidden: an element backed by a gradient
 * or image cannot be reduced to a single colour, so those are counted
 * separately and never failed. A sibling tool called a perfectly legible
 * dark-on-yellow-gradient button 1.19:1 by reading only `background-color` —
 * a false failure costs as much trust as a false pass.
 *
 * The fixtures run first and this refuses to assert anything if they are
 * wrong. That is not ceremony: my own first expected value for the alpha
 * fixture was wrong, and the fixture caught ME rather than the page.
 */

const ROUTES = [
  "/",
  "/methodology/",
  "/models/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

function audit() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (g === null) throw new Error("no 2d context");

  const composite = (layers: string[]): [number, number, number] => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 1, 1);
    for (const c of layers) {
      if (c === "" || c === "transparent" || c === "rgba(0, 0, 0, 0)") continue;
      g.fillStyle = c;
      g.fillRect(0, 0, 1, 1);
    }
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
  };

  const lum = ([r, gr, b]: [number, number, number]): number => {
    const f = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(gr) + 0.0722 * f(b);
  };

  const ratio = (a: [number, number, number], b: [number, number, number]): number => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const white = composite(["#ffffff"]);
  const fixtures = {
    blackOnWhite: ratio(composite(["#000000"]), white),
    greyOnWhite: ratio(composite(["#767676"]), white),
    alpha40: ratio(composite(["#ffffff", "rgba(0,0,0,0.4)"]), white),
    oklab: ratio(composite(["#ffffff", "oklab(0.206299 0.00176432 0.0105445 / 0.4)"]), white),
  };

  const NON_RENDERED = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);
  const failures: string[] = [];
  const seen = new Set<string>();

  for (const el of document.body.querySelectorAll("*")) {
    if (NON_RENDERED.has(el.tagName)) continue;
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

    const chain: string[] = [];
    let gradient = false;
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (ncs.backgroundImage !== "none") gradient = true;
      chain.push(ncs.backgroundColor);
    }
    if (gradient) continue; // unmeasurable, never failed
    chain.reverse();

    const bg = composite(chain);
    const fg = composite([...chain, cs.color]);
    const r = ratio(fg, bg);

    const px = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const required = px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5;

    const key = `${own.slice(0, 40)}|${cs.color}|${String(px)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (r < required) {
      failures.push(`${r.toFixed(2)}:1 (need ${String(required)}) ${String(px)}px "${own.slice(0, 40)}" ${cs.color}`);
    }
  }
  return { fixtures, failures };
}

for (const route of ROUTES) {
  test(`WCAG 1.4.3 contrast on ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);

    const { fixtures, failures } = await page.evaluate(audit);

    // The probe must get known values right before its verdicts mean anything.
    expect(fixtures.blackOnWhite).toBeCloseTo(21, 1);
    expect(fixtures.greyOnWhite).toBeCloseTo(4.54, 1);
    expect(fixtures.alpha40).toBeCloseTo(2.849, 1);
    expect(fixtures.oklab, "oklab must parse, not fall through to a number grab").toBeGreaterThan(2);
    expect(fixtures.oklab).toBeLessThan(3.5);

    expect(failures, "text below the WCAG AA contrast floor").toEqual([]);
  });
}
