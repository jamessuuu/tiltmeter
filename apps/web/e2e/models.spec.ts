import { test, expect } from "@playwright/test";

/**
 * SPEC §10/§13: "/models: NO ranking, NO scores, NO leaderboard — the
 * death-condition guard." Structural assertions, not just a text search —
 * the page's own disclaimer prose legitimately contains the words "score"
 * and "rank" ("deliberately NOT a leaderboard — no score, no rank…"), so
 * this test checks for the absence of an actual ranking UI ELEMENT
 * (a table column header naming a score/rank, or a numeric metric value
 * anywhere on the page), not merely the absence of those words.
 */
test.describe("/models — the death-condition guard", () => {
  test("no table column is a score or rank", async ({ page }) => {
    await page.goto("/models/");
    const headers = await page.locator("table thead th").allTextContents();
    for (const header of headers) {
      expect(header.toLowerCase()).not.toMatch(/score|rank|accuracy|pass rate|win/);
    }
    // The only columns this page is allowed: model identity + metadata.
    expect(headers.map((h) => h.trim())).toEqual(["Model", "Panel role", "Released", "Source"]);
  });

  test("no numeric metric value is rendered anywhere on the page", async ({ page }) => {
    await page.goto("/models/");
    const bodyText = await page.locator("body").innerText();
    // A percentage or a bare decimal (0.xx) would be the shape of a
    // capability/pass-rate number — neither should ever appear here.
    expect(bodyText).not.toMatch(/\d+(\.\d+)?%/);
    expect(bodyText).not.toMatch(/\b0\.\d{2,}\b/);
  });

  test("models are listed in panel-declaration order, not sorted by any metric (there is none to sort by)", async ({ page }) => {
    await page.goto("/models/");
    const rows = await page.locator("table tbody tr td:first-child").allTextContents();
    expect(rows).toEqual(["Claude Haiku 4.5", "Claude Sonnet 5", "Claude Haiku 4.5"]);
  });
});
