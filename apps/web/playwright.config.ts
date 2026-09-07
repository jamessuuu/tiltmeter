import { defineConfig, devices } from "@playwright/test";

/**
 * SPEC §14 M6: "Playwright e2e replacing the CI echo no-op." Runs against
 * the REAL static export (`next build --webpack` then a static file
 * server) — never `next dev` — so what these tests see is exactly what
 * ships (SPEC §7: "output: export … the site is 100% static").
 *
 * PORT + REUSE (fixed 2026-09-07). This config previously pinned port 4173
 * and set `reuseExistingServer: !process.env.CI`. That combination is a
 * live foot-gun: 4173 is Vite's default preview port, so any sibling
 * project's preview server already listening on it would be silently
 * ADOPTED, and the entire suite would then run against a different
 * project's website and report failures that have nothing to do with this
 * repo. That exact failure hit two sibling projects today (one asserted
 * against another project on 4173; another on 4174). Reuse is now off
 * unconditionally — Playwright always starts its own server and fails
 * loudly if the port is busy — and the port comes from `E2E_PORT` so a
 * developer running two suites at once can separate them without editing
 * this file.
 */
const PORT = Number(process.env.E2E_PORT ?? 47317);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx serve out -p ${String(PORT)} -n -L`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
