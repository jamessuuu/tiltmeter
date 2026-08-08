import { defineConfig, devices } from "@playwright/test";

/**
 * SPEC §14 M6: "Playwright e2e replacing the CI echo no-op." Runs against
 * the REAL static export (`next build --webpack` then a static file
 * server) — never `next dev` — so what these tests see is exactly what
 * ships (SPEC §7: "output: export … the site is 100% static").
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "html",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx serve out -p 4173 -n -L",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
