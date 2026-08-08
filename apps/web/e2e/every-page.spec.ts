import { test, expect } from "@playwright/test";

/** BRAND-KIT.md: "Site footer on every page" + "Favicon — the chip mark family." Checked on one representative page per route shape (static, dynamic-suite, dynamic-reading). */
const PAGES = [
  "/",
  "/models/",
  "/methodology/",
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

    const favicon = page.locator("link[rel='icon']");
    await expect(favicon).toHaveAttribute("href", "/brand/favicon.svg");
  });
}

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
