import { test, expect } from "@playwright/test";

/**
 * DESIGN-DIRECTION.md: the mechanism diagram and the demo recording, both
 * on `/`, plus `/docs`. `/models`'s no-ranking-UI guard lives in its own
 * file (e2e/models.spec.ts) and is untouched by this pass.
 */

test.describe("the attribution diagram", () => {
  test("renders as inline SVG with a real title/desc, not an img+alt", async ({ page }) => {
    await page.goto("/");
    const figure = page.getByTestId("attribution-diagram");
    await expect(figure).toBeVisible();
    const svg = figure.locator("svg");
    await expect(svg).toHaveAttribute("role", "img");
    // Inline SVG's own <title>/<desc> (not an <img alt="...">) — the
    // accessible name comes from inside the SVG, per DESIGN-DIRECTION.md.
    await expect(svg.locator("title")).toContainText("axis tuple");
    await expect(svg.locator("desc")).not.toHaveCount(0);
    // Exactly one amber element, per DESIGN-DIRECTION.md's diagram rule.
    const amberElements = await svg.locator('[fill="#B45309"], [stroke="#B45309"]').count();
    expect(amberElements).toBeGreaterThan(0);
  });

  test("also renders on /docs, next to the attribution-model prose", async ({ page }) => {
    await page.goto("/docs/");
    await expect(page.getByTestId("attribution-diagram")).toBeVisible();
  });
});

test.describe("the demo recording — full motion", () => {
  test("poster + muted, looping, chrome-free video, sourced from real files", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);

    const video = page.getByTestId("demo-video-el");
    await expect(video).toHaveAttribute("poster", "/demo/tiltmeter-poster.png");
    await expect(video).toHaveAttribute("loop", "");
    await expect(video).toHaveAttribute("playsinline", "");
    expect(await video.evaluate((el: HTMLVideoElement) => el.muted)).toBe(true);
    expect(await video.evaluate((el: HTMLVideoElement) => el.autoplay)).toBe(true);
    expect(await video.evaluate((el: HTMLVideoElement) => el.hasAttribute("controls"))).toBe(false);

    const source = video.locator("source");
    await expect(source).toHaveAttribute("src", "/demo/tiltmeter-demo.webm");

    // The poster and the video file are both real, fetchable assets.
    const posterRes = await page.request.get("/demo/tiltmeter-poster.png");
    expect(posterRes.status()).toBeLessThan(400);
    const videoRes = await page.request.get("/demo/tiltmeter-demo.webm");
    expect(videoRes.status()).toBeLessThan(400);
  });

  test("has a visible, adjacent text alternative describing what it shows", async ({ page }) => {
    await page.goto("/");
    const figure = page.getByTestId("demo-video");
    const caption = figure.locator("figcaption");
    await expect(caption).toBeVisible();
    await expect(caption).toContainText("real deployed site");
  });
});

test.describe("the demo recording — prefers-reduced-motion", () => {
  // `reducedMotion` isn't declared on this Playwright version's `test.use()`
  // options type (present only in a doc comment, not the interface itself)
  // — `page.emulateMedia` is the equivalent, fully-typed runtime call.
  test("shows the poster frame and a link, never an autoplaying video", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const video = page.getByTestId("demo-video-el");
    const reduced = page.getByTestId("demo-reduced");
    await expect(video).toBeHidden();
    await expect(reduced).toBeVisible();
    await expect(reduced.locator("img")).toBeVisible();
    await expect(reduced.locator("a")).toHaveAttribute("href", "/demo/tiltmeter-demo.webm");
  });
});

test.describe("/docs", () => {
  test("reachable, and covers the no-key quickstart", async ({ page }) => {
    const response = await page.goto("/docs/");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("h1")).toHaveText("Docs");
    const body = page.locator("body");
    await expect(body).toContainText("init --from-skills");
    await expect(body).toContainText("tiltmeter lint");
    await expect(body).toContainText("plan --run-group demo-1 --offline");
  });
});
