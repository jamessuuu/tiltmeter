import type { FullConfig } from "@playwright/test";

/**
 * Prove the suite is talking to THIS project before a single test runs.
 *
 * Two sibling projects in this portfolio spent a debugging session on
 * failures that had nothing to do with them: their e2e suites ran against a
 * different project's website. The mechanism is worth writing down because
 * it is invisible from the test output — the tests just fail, or worse,
 * pass.
 *
 *  1. `pnpm run <script> -- --port N` silently DISCARDS the flags: pnpm
 *     forwards a literal "--" as argv[0], the tool never sees `--port`, and
 *     falls back to its default. (This config avoids that by invoking the
 *     server binary directly, not through a pnpm script.)
 *  2. A default port (4173, 4174) is shared by every Vite-ish project on the
 *     machine, so a sibling's preview server is often already holding it.
 *  3. `reuseExistingServer: true` then ADOPTS that neighbour's server, and
 *     the whole suite asserts against someone else's site.
 *
 * This config already fixes 1-3 (direct binary, E2E_PORT, reuse off). This
 * file is the belt: a 200 does not mean the response is ours, so the served
 * root is fetched and checked for a tiltmeter-specific string. A suite that
 * passes against a neighbour's website is worse than one that fails, and a
 * cascade of confusing assertion errors is worse than one clear sentence.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("global-setup: no baseURL configured");

  const res = await fetch(baseURL);
  if (!res.ok) {
    throw new Error(`global-setup: ${baseURL} responded ${String(res.status)} — the server did not come up.`);
  }
  const html = await res.text();

  // Strings that only this project's landing page carries. Checked in the
  // served HTML (statically exported, so they are present pre-hydration).
  const fingerprints = ["tiltmeter", "suiteSpecHash", "calibration"];
  const missing = fingerprints.filter((f) => !html.toLowerCase().includes(f.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      [
        `global-setup: ${baseURL} is serving something that is NOT tiltmeter.`,
        `Missing fingerprint(s): ${missing.join(", ")}.`,
        "Another project's server is almost certainly holding this port.",
        "Set E2E_PORT to a free port, or stop the other server, then re-run.",
      ].join(" "),
    );
  }
}
