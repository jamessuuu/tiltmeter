import { test, expect } from "@playwright/test";

/**
 * Nothing on any route may still move under prefers-reduced-motion.
 *
 * This is checked by RENDERING because it cannot be checked any other way:
 * Tailwind's `transition-*` utilities emit their transition-property and
 * duration unconditionally and are not wrapped in the media query, so a
 * `@media (prefers-reduced-motion: reduce)` block that names only its own
 * selectors silently fails to reach them. A single `transition-transform`
 * on the disclosure caret survived at 150ms this way — every keyframe
 * animation on the page correctly went to zero, which made it look handled.
 * Reading the CSS would not have found it.
 *
 * 20ms perceptibility floor: the 0.001s idiom is deliberate (it keeps
 * `transitionend`/`animationend` handlers firing rather than hanging) and
 * must not be counted as surviving motion.
 */

const ROUTES = [
  "/",
  "/methodology/",
  "/models/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

const FLOOR_SECONDS = 0.02;

/** Longest duration in a comma-separated computed value, in seconds. */
function measure() {
  const longest = (value: string): number =>
    Math.max(
      ...value.split(",").map((part) => {
        const t = part.trim();
        const n = parseFloat(t);
        if (Number.isNaN(n)) return 0;
        return t.endsWith("ms") ? n / 1000 : n;
      }),
      0,
    );
  const floor = 0.02;
  const moving: string[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const td = longest(cs.transitionDuration);
    const ad = longest(cs.animationDuration);
    if (td >= floor || (ad >= floor && cs.animationName !== "none")) {
      // el.className is a string on HTMLElement but SVGAnimatedString on
      // SVG elements, so it is read defensively rather than coerced.
      const cls = typeof el.className === "string" ? el.className : el.getAttribute("class");
      moving.push(`${el.tagName.toLowerCase()}.${(cls ?? "").slice(0, 50)}`);
    }
  }
  return moving;
}

test.describe("prefers-reduced-motion is honoured on every route", () => {
  for (const route of ROUTES) {
    test(`nothing animates or transitions on ${route}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const moving = await page.evaluate(measure);
      expect(moving, `elements still moving above ${String(FLOOR_SECONDS)}s`).toEqual([]);
    });
  }

  // The counterpart: proving motion is actually PRESENT by default, so the
  // test above cannot be satisfied by a site that simply has no motion.
  test("motion is present when the visitor has not asked for less", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const moving = await page.evaluate(measure);
    expect(moving.length).toBeGreaterThan(10);
  });
});
