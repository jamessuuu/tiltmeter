import { test, expect } from "@playwright/test";

/**
 * No decorative mark may be a font glyph.
 *
 * The vendored woff2 files are subset to the Google Fonts latin range, so a
 * character outside it is not in the font at all and the browser falls
 * through to the visitor's system face — tofu on a machine without
 * coverage. Measured on the shipped page, U+25B8 ▸ (a disclosure caret) and
 * a bare U+2192 → (between two prices) both fell back that way.
 *
 * The rule this pins, which is a judgement and not a blanket ban:
 *
 *   A non-ASCII character that is ITS OWN TEXT NODE is decorative — it is
 *   doing an icon's job, has no semantic role to preserve, and must be an
 *   inline SVG (components/Marks.tsx).
 *
 *   The same character INLINE inside a sentence stays text. "methodology →"
 *   and a mono hash chain "a1b2c3 → d4e5f6" are read, selected and copied;
 *   replacing them with SVG would break selection, copy-paste and
 *   screen-reader order to guard against characters every default platform
 *   font covers. Em dashes fall back too, and they also stay.
 *
 * tools/screens/glyph-check.mjs is the fuller instrument — it measures real
 * advance widths against the actual vendored fonts, with two controls that
 * prove it can tell covered from uncovered before it reports anything. This
 * test is the cheap invariant that runs on every push.
 */

const ROUTES = [
  "/",
  "/methodology/",
  "/models/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

for (const route of ROUTES) {
  test(`no decorative glyph stands alone on ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    const standalone = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const g = canvas.getContext("2d");
      if (g === null) throw new Error("no 2d context");

      /**
       * Does `family` actually supply a glyph for `ch`, or is the fallback
       * showing through? Measured, not inferred from the codepoint: the
       * vendored files turned out to be subset MORE tightly than the range
       * substrate.css declares, so reasoning about ranges gives the wrong
       * answer in both directions. U+00B7 · is covered and must not be
       * flagged; U+25B8 ▸ is not and must be.
       */
      const covered = (ch: string, family: string, fallback: string): boolean => {
        g.font = `32px ${fallback}`;
        const bare = g.measureText(ch).width;
        g.font = `32px "${family}", ${fallback}`;
        return g.measureText(ch).width !== bare;
      };

      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node !== null) {
        const text = (node.nodeValue ?? "").trim();
        const el = node.parentElement;
        // Decorative = the character is the ENTIRE text of its element.
        //
        // "Alone in its own text node" is the wrong test and produced a false
        // positive: JSX splits `{a} — {b}` so the em dash in "The identical
        // plan — 12 cells" lands in its own text node while plainly being
        // inline prose. What makes a mark decorative is that nothing else in
        // its element carries meaning, which is what an icon looks like.
        const elText = (el?.textContent ?? "").trim();
        if (
          text.length > 0 &&
          // Code-point length, not UTF-16 length: a single astral character
          // is two code units, and this must treat it as one. Spread is the
          // idiomatic way to get that, but the lint rule (correctly) warns
          // it decomposes grapheme clusters — which is fine here, because
          // the question is exactly "is this ONE code point", not "is this
          // one user-perceived character".
          // eslint-disable-next-line @typescript-eslint/no-misused-spread
          [...text].length === 1 &&
          (text.codePointAt(0) ?? 0) > 127 &&
          el !== null &&
          elText === text
        ) {
          const cs = getComputedStyle(el);
          if (cs.display !== "none" && cs.visibility !== "hidden") {
            const family = (cs.fontFamily.split(",")[0] ?? "sans-serif").replace(/["']/g, "").trim();
            const fallback = family.toLowerCase().includes("mono") ? "monospace" : "sans-serif";
            if (!covered(text, family, fallback)) {
              found.push(
                `U+${(text.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")} "${text}" in <${el.tagName.toLowerCase()}> (${family})`,
              );
            }
          }
        }
        node = walker.nextNode();
      }
      return found;
    });

    expect(standalone, "decorative marks must be inline SVG, not font glyphs").toEqual([]);
  });
}

test("the disclosure caret is an SVG and still rotates when opened", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator("summary").first();
  const svg = summary.locator("svg");
  await expect(svg).toHaveCount(1);
  // aria-hidden because the adjacent label already carries the meaning.
  await expect(svg).toHaveAttribute("aria-hidden", "true");

  // Tailwind 4 emits the INDEPENDENT `rotate:` property, not `transform:`
  // — `group-open:rotate-90` compiles to `{rotate: 90deg}`. Reading
  // `transform` returns "none" in both states and the assertion looks like
  // a product failure when it is a test reading the wrong property.
  const read = () =>
    svg.evaluate((el) => {
      const cs = getComputedStyle(el);
      return `${cs.rotate}|${cs.transform}`;
    });
  const before = await read();
  expect(before).toBe("none|none");
  await summary.click();
  await expect(page.locator("details").first()).toHaveAttribute("open", "");
  await page.waitForTimeout(500);
  expect(await read()).toBe("90deg|none");
});
