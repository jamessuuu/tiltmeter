import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatPct, loadCalibration } from "./calibration.js";

// vitest.config.ts's "unit" project runs from the repo root, not apps/web,
// so loadCalibration's process.cwd()-based default would resolve outside
// the repo here — pass the real root explicitly (this test file lives at
// apps/web/lib/calibration.test.ts; the repo root is three levels up).
// `fileURLToPath` + `dirname` rather than `import.meta.dirname`: the more
// portable form (see lib/calibration.ts's own comment on why the shorthand
// doesn't survive webpack's server bundling in this project).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("loadCalibration", () => {
  it("reads the committed calibration result and both gates read as real numbers", () => {
    const r = loadCalibration(REPO_ROOT);
    expect(r.falsePositive.trials).toBe(200);
    expect(r.detectionPower.trials).toBe(200);
    expect(r.falsePositive.rate).toBeGreaterThanOrEqual(0);
    expect(r.falsePositive.rate).toBeLessThanOrEqual(1);
    expect(r.detectionPower.rate).toBeGreaterThanOrEqual(0);
    expect(r.detectionPower.rate).toBeLessThanOrEqual(1);
  });
});

describe("formatPct", () => {
  it("renders one decimal place, no rounding surprises on exact values", () => {
    expect(formatPct(0)).toBe("0.0%");
    expect(formatPct(0.95)).toBe("95.0%");
    expect(formatPct(1)).toBe("100.0%");
  });
});
