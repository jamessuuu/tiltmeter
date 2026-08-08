// SPEC §8 M7 `health.yml`: "daily; fails loudly and opens an issue if the
// newest reading is >14 days old." This script is the "fails loudly" half
// — it exits 1 (with a human-readable reason on stdout) when stale, exit 0
// otherwise. `health.yml`'s own `gh issue create` step (guarded by
// `if: failure()`) is the "opens an issue" half.
//
// Requires `pnpm --filter tiltmeter build` first — imports the compiled
// dist (mirrors scripts/calibration-report.mjs's pattern). The pure
// decision (`computeHealthState`/`newestRealReadingAt`) lives in
// packages/tiltmeter/src/core/health.ts with its own unit tests; this file
// is CI wiring only (reads observatory/readings/index.json off disk).
//
//   node scripts/health-check.mjs
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const INDEX_PATH = resolve(ROOT, "observatory", "readings", "index.json");

const { computeHealthState, newestRealReadingAt, parseIndex, HEALTH_STALE_THRESHOLD_DAYS } = await import(
  "../packages/tiltmeter/dist/index.js"
);

if (!existsSync(INDEX_PATH)) {
  console.log(
    "health-check: no observatory/readings/index.json yet — pre-launch state, not staleness (SPEC §11). OK.",
  );
  process.exit(0);
}

const chain = parseIndex(JSON.parse(readFileSync(INDEX_PATH, "utf8")));
const newestAt = newestRealReadingAt(chain);
const state = computeHealthState(newestAt, new Date().toISOString());

if (newestAt === undefined) {
  console.log("health-check: index.json exists but no run group has produced a real reading yet. OK (not staleness).");
  process.exit(0);
}

if (!state.stale) {
  console.log(`health-check: OK — newest reading is ${String(state.daysSinceNewestReading)} day(s) old (threshold ${String(HEALTH_STALE_THRESHOLD_DAYS)}).`);
  process.exit(0);
}

console.error(
  `health-check: STALE — newest reading is ${String(state.daysSinceNewestReading)} day(s) old ` +
    `(threshold ${String(HEALTH_STALE_THRESHOLD_DAYS)}), last at ${newestAt}.`,
);
// health.yml's own issue-creation step re-runs this same check to build the
// issue body (`if: failure()`, `continue-on-error: true` on this step) —
// no `GITHUB_OUTPUT` plumbing needed here; keeps this script a plain,
// locally-runnable CLI tool with no GitHub Actions-specific output format
// to keep in sync.
process.exit(1);
