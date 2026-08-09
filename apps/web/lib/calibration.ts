/**
 * Build-time read of the committed calibration result (SPEC §12) — the two
 * numbers the hero leans on: false-positive rate and detection power. Same
 * pattern as lib/observatory.ts: a synchronous `fs` read of a committed
 * JSON file, resolved from `process.cwd()` (Next's Server Components run
 * with cwd `apps/web` at `next build` time — the same assumption
 * observatory.ts already relies on). `import.meta.dirname` looked more
 * robust in isolation but does not survive webpack's server bundling here
 * (`next build --webpack` throws `paths[0] must be of type string` — the
 * bundled value comes back `undefined`), so `loadCalibration` takes an
 * optional `repoRoot` override instead: production leaves it at the
 * default, and lib/calibration.test.ts (running under Vitest from the repo
 * root, a different cwd) passes its own.
 * `scripts/calibration-report.mjs --check` (CI's `calibration-drift`
 * stage) is what keeps this file honest against a fresh simulation — this
 * loader only renders what is already committed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CalibrationResult {
  generatedAt: string;
  itemCount: number;
  trials: number;
  bootstrapB: number;
  degradedCount: number;
  falsePositive: { trials: number; fires: number; rate: number };
  detectionPower: { trials: number; fires: number; rate: number };
}

/** `repoRoot` defaults to two levels up from cwd (apps/web -> apps -> repo root at `next build` time). */
export function loadCalibration(repoRoot: string = join(process.cwd(), "..", "..")): CalibrationResult {
  const path = join(repoRoot, "evals", "calibration", "results", "latest.json");
  return JSON.parse(readFileSync(path, "utf8")) as CalibrationResult;
}

/** One decimal place, no locale — matches scripts/calibration-report.mjs's own `pct`. */
export function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
