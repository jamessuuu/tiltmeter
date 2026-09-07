import { test, expect } from "@playwright/test";

/**
 * SPEC §14 M6 gate: "/ renders with javaScriptEnabled:false" — the
 * dedicated `describe` block below disables JS entirely for this browser
 * context, proving the core content is real server-rendered static HTML
 * (SPEC §7: output:"export"), not something only a client-JS hydration
 * pass produces.
 */
test.describe("/ with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("still renders the title, tagline, and the honest launch-state copy", async ({ page }) => {
    await page.goto("/");
    // The h1 is the CLAIM, not the wordmark (changed 2026-09-07). This
    // assertion used to read toHaveText("tiltmeter"), which pinned the
    // document's only h1 to a 14px masthead label while the 68px sentence a
    // sighted visitor reads as the headline was a <p> — so the visual
    // hierarchy and the document outline disagreed, and a screen-reader user
    // navigating by heading met the project name instead of what the page
    // proves. Every sibling route already owned a real heading; only "/" did
    // not. The test's intent was always "this is real server-rendered HTML",
    // which it still checks — now against the heading that deserves to be one.
    await expect(page.locator("h1")).toHaveText(
      "The detector fires when your harness moves, and not when it doesn't.",
    );
    // The wordmark still renders, in the masthead and the hero eyebrow, as a
    // label rather than a heading.
    await expect(page.locator("header").getByText("tiltmeter")).toBeVisible();
    const launchState = page.getByTestId("launch-state");
    await expect(launchState).toContainText("tiltmeter launched");
    await expect(launchState).toContainText("pre-registered suites");
    await expect(launchState).toContainText(
      "There is no time series yet — that is what pre-registration means. The series starts here.",
    );
  });

  test("still renders every suite section, linked, with no JS required", async ({ page }) => {
    await page.goto("/");
    for (const id of ["house-skill-activation", "mcp-tool-selection", "routing-adherence", "output-contract"]) {
      const section = page.getByTestId(`suite-${id}`);
      await expect(section).toBeVisible();
      await expect(section.locator("a", { hasText: id })).toHaveAttribute("href", `/suites/${id}/`);
    }
  });
});

test.describe("/ with JavaScript enabled", () => {
  test("SPEC §11: reports exactly 4 suites and 108 items", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("launch-state")).toContainText("4 pre-registered suites and 108 items");
  });

  test("the dead-man banner does not render — there has never been a reading, which is a different, honest state", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("dead-man-banner")).toHaveCount(0);
  });
});
