import { test, expect } from "@playwright/test";

/** BRAND-KIT.md: "Site footer on every page" + the per-project favicon (icon hierarchy changed 2026-08-09: the project glyph is the favicon, the chip stays the maker's mark in the footer). Checked on one representative page per route shape (static, dynamic-suite, dynamic-reading). */
const PAGES = [
  "/",
  "/models/",
  "/methodology/",
  "/docs/",
  "/suites/house-skill-activation/",
  "/readings/none-yet/",
];

for (const path of PAGES) {
  test(`footer + favicon present on ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(400);

    const footer = page.locator("footer");
    await expect(footer).toContainText("Built by James Lorenz Santos");
    await expect(footer.locator("a[href='https://agentjames.vercel.app']")).toBeVisible();
    await expect(footer.locator("a[href='https://github.com/jamessuuu/tiltmeter']")).toBeVisible();

    // BRAND-KIT.md D1: no hire-me CTA anywhere.
    await expect(page.locator("body")).not.toContainText(/hire me|book a call|available for work/i);

    // BRAND-KIT.md "Icon hierarchy — CHANGED 2026-08-09": the favicon is now
    // the project's own compact glyph, not the shared chip maker's mark
    // (that stays in the footer, asserted above). The DOM check alone can't
    // catch a stale/broken asset reference, so this also does a real HTTP
    // fetch of the resolved href and checks it actually resolves.
    const favicon = page.locator("link[rel='icon']").first();
    await expect(favicon).toHaveAttribute("href", "/brand/favicon.svg");
    const faviconHref = (await favicon.getAttribute("href")) ?? "/brand/favicon.svg";
    const faviconResponse = await page.request.get(faviconHref);
    expect(faviconResponse.status()).toBe(200);
    expect(faviconResponse.headers()["content-type"]).toContain("image/svg+xml");
  });
}

test("icon family resolves with real HTTP responses (BRAND-KIT.md icon hierarchy)", async ({ page }) => {
  await page.goto("/");

  // Every href the metadata actually declares, checked in the DOM first so
  // this fails loudly if layout.tsx's icons config ever drifts from what
  // scripts/brand.mjs emits.
  await expect(page.locator("link[rel='icon'][href='/brand/favicon.svg']")).toHaveCount(1);
  await expect(page.locator("link[rel='icon'][href='/brand/favicon-16.png']")).toHaveAttribute("sizes", "16x16");
  await expect(page.locator("link[rel='icon'][href='/brand/favicon-32.png']")).toHaveAttribute("sizes", "32x32");
  await expect(page.locator("link[rel='icon'][href='/brand/favicon-48.png']")).toHaveAttribute("sizes", "48x48");
  await expect(page.locator("link[rel='apple-touch-icon']")).toHaveAttribute("href", "/brand/apple-touch-icon.png");
  await expect(page.locator("link[rel='mask-icon']")).toHaveAttribute("href", "/brand/icon-maskable.svg");
  const manifestLink = page.locator("link[rel='manifest']");
  await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");

  // Real HTTP requests against every asset the icon family references — the
  // Next.js file-convention icon.svg/apple-icon.png are static exports too,
  // so they're checked alongside the public/brand/** originals.
  const assets: [string, string][] = [
    ["/brand/favicon.svg", "image/svg+xml"],
    ["/brand/favicon-16.png", "image/png"],
    ["/brand/favicon-32.png", "image/png"],
    ["/brand/favicon-48.png", "image/png"],
    ["/brand/apple-touch-icon.png", "image/png"],
    ["/brand/icon-maskable.svg", "image/svg+xml"],
    ["/brand/icon-192.png", "image/png"],
    ["/brand/icon-512.png", "image/png"],
    ["/brand/og.png", "image/png"],
    ["/brand/mark.svg", "image/svg+xml"], // the chip — still the footer's mark, unchanged
    ["/icon.svg", "image/svg+xml"],
    ["/apple-icon.png", "image/png"],
    ["/manifest.webmanifest", "application/manifest+json"],
  ];
  for (const [href, contentType] of assets) {
    const res = await page.request.get(href);
    expect(res.status(), `${href} should resolve`).toBe(200);
    expect(res.headers()["content-type"], `${href} content-type`).toContain(contentType);
  }

  // The favicon actually IS the tiltmeter glyph, not the chip: the old
  // favicon.svg was chip(INK, AMBER, {pins:3}) with the default "Agent
  // James" aria-label; the regenerated one carries the project-specific
  // label brand.mjs sets on the compact glyph. A byte-level guard so a
  // future regen can't silently point favicon.svg back at the chip.
  const faviconBody = await (await page.request.get("/brand/favicon.svg")).text();
  expect(faviconBody).toContain('aria-label="tiltmeter icon"');
  expect(faviconBody).not.toContain('aria-label="Agent James"');
});

test("all four launch suites are reachable from /suites/<id>", async ({ page }) => {
  for (const id of ["house-skill-activation", "mcp-tool-selection", "routing-adherence", "output-contract"]) {
    const response = await page.goto(`/suites/${id}/`);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("h1")).toHaveText(id);
  }
});

test("/readings/none-yet honestly states no run group exists yet", async ({ page }) => {
  await page.goto("/readings/none-yet/");
  await expect(page.getByTestId("no-run-groups-yet")).toContainText("No run group has been recorded yet");
});
