import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCalibration } from "./calibration.js";

/**
 * Pins the few numbers the site renders that are NOT read from an artifact.
 *
 * Everything else on `/` is computed at build time from committed JSON, so
 * it cannot go stale. These cannot make that claim: the two calibration
 * bars and the three spend caps are typed into TSX by hand, and a hand-typed
 * number next to a computed one is exactly how a page ends up advertising
 * "13 artifacts" while writing 17. So they are asserted against the
 * artifacts they describe.
 *
 * Written after a sibling agent's reminder that a checker which has never
 * been seen to FAIL is not evidence of anything — each assertion below was
 * confirmed to fail when the expected value was deliberately altered.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, "apps", "web", rel), "utf8");
}

describe("hand-typed page constants match their artifacts", () => {
  it("the calibration bars match the gates SPEC §12 declares", () => {
    // scripts/calibration-report.mjs renders the README block from these
    // same two bars; if either moves there, this fails.
    const script = readFileSync(join(REPO_ROOT, "scripts", "calibration-report.mjs"), "utf8");
    expect(script).toContain("≤ 5%");
    expect(script).toContain("≥ 90%");

    const gates = readSource("components/CalibrationGates.tsx");
    expect(gates).toContain("const FALSE_POSITIVE_CEILING = 0.05;");
    expect(gates).toContain("const DETECTION_POWER_FLOOR = 0.9;");
  });

  it("both gates are actually cleared by the committed result, so the page may say so", () => {
    const c = loadCalibration(REPO_ROOT);
    expect(c.falsePositive.rate).toBeLessThanOrEqual(0.05);
    expect(c.detectionPower.rate).toBeGreaterThanOrEqual(0.9);
    // The hero card and the section heading both assert "both gates cleared".
    expect(readSource("components/CalibrationGates.tsx")).toContain("both gates cleared");
  });

  it("/methodology's spend caps match the caps in the newest committed plan", () => {
    const plan = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "observatory", "readings", "rg-20260831-1", "plan.json"),
        "utf8",
      ),
    ) as { caps: { maxCellUsd: number; maxRunUsd: number; maxMonthUsd: number } };

    const page = readSource("app/methodology/page.tsx");
    expect(page).toContain(`v="$${plan.caps.maxCellUsd.toFixed(2)}"`);
    expect(page).toContain(`v="$${plan.caps.maxRunUsd.toFixed(2)}"`);
    expect(page).toContain(`v="$${plan.caps.maxMonthUsd.toFixed(2)}"`);
  });

  it("/methodology's bootstrap B is read from the artifact, not typed", () => {
    const page = readSource("app/methodology/page.tsx");
    // The spec strip must derive B rather than hardcode it.
    expect(page).toContain("calibration.bootstrapB");
    expect(page).not.toMatch(/v="10,000"/);
  });

  it("the sampling constants on /methodology match every launch suite", () => {
    const suites = ["house-skill-activation", "mcp-tool-selection", "output-contract", "routing-adherence"];
    for (const id of suites) {
      const suite = JSON.parse(
        readFileSync(join(REPO_ROOT, "observatory", "suites", `${id}.suite.json`), "utf8"),
      ) as { sampling: { k: number; temperature: number } };
      expect(suite.sampling.k, `${id} k`).toBe(3);
      expect(suite.sampling.temperature, `${id} temperature`).toBe(1);
    }
    const page = readSource("app/methodology/page.tsx");
    expect(page).toContain('v="k=3"');
    expect(page).toContain('v="1.0"');
  });
});
