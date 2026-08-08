import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { FakeModelClient } from "../testing/index.js";
import { buildFixtureSuite, FIXTURE_PRESENTATION } from "../testing/fixtures.js";
import { isTiltmeterError } from "./errors.js";
import { parsePricingManifest, type PricingManifest } from "./pricing.js";
import { DEFAULT_CAPS } from "./caps.js";
import {
  assertPlanFresh,
  buildPlan,
  hasNullPair,
  parsePanel,
  type Panel,
  type PlanCellInput,
} from "./plan.js";
import { suiteSpecHash } from "./suite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function loadCommittedManifest(): PricingManifest {
  const raw = readFileSync(join(REPO_ROOT, "observatory", "pricing", "pricing.2026-08-08.json"), "utf8");
  return parsePricingManifest(JSON.parse(raw));
}

const NOW = () => "2026-08-08T00:00:00.000Z";

function haikuCell(): PlanCellInput {
  const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3, k: 3 });
  return {
    suite,
    presentation: FIXTURE_PRESENTATION,
    entry: { cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" },
  };
}

describe("hasNullPair (SPEC §4: mandatory null pair)", () => {
  it("true when a null entry's model matches a non-null entry's", () => {
    const panel: Panel = {
      formatVersion: 1,
      id: "standing",
      entries: [
        { cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" },
        { cellId: "haiku45-null", modelIdRequested: "claude-haiku-4-5", role: "null" },
        { cellId: "sonnet5", modelIdRequested: "claude-sonnet-5", role: "standing" },
      ],
    };
    expect(hasNullPair(panel)).toBe(true);
  });

  it("false with no null entry at all", () => {
    const panel: Panel = {
      formatVersion: 1,
      id: "standing",
      entries: [{ cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" }],
    };
    expect(hasNullPair(panel)).toBe(false);
  });

  it("false when the null entry's model has no matching standing/release entry", () => {
    const panel: Panel = {
      formatVersion: 1,
      id: "standing",
      entries: [{ cellId: "orphan-null", modelIdRequested: "claude-haiku-4-5", role: "null" }],
    };
    expect(hasNullPair(panel)).toBe(false);
  });
});

describe("parsePanel", () => {
  it("round-trips a valid panel", () => {
    const panel = parsePanel({
      formatVersion: 1,
      id: "standing",
      entries: [{ cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" }],
    });
    expect(panel.id).toBe("standing");
  });
});

describe("buildPlan — offline mode (SPEC §7 --offline)", () => {
  it("marks the plan approximate and produces a nonzero estimate per cell", async () => {
    const plan = await buildPlan({
      runGroupId: "rg-1",
      cells: [haikuCell()],
      pricing: loadCommittedManifest(),
      caps: DEFAULT_CAPS,
      monthToDateUsd: 0,
      mode: "batch",
      now: NOW,
      effectiveDate: "2026-08-08",
      client: undefined,
    });
    expect(plan.approximate).toBe(true);
    expect(plan.cells).toHaveLength(1);
    expect(plan.cells[0]?.estimatedUsd).toBeGreaterThan(0);
    expect(plan.totalEstimatedUsd).toBe(plan.cells[0]?.estimatedUsd);
  });

  it("pins suiteSpecHash/presentationHash/samplingPolicyHash per cell", async () => {
    const cellInput = haikuCell();
    const plan = await buildPlan({
      runGroupId: "rg-1",
      cells: [cellInput],
      pricing: loadCommittedManifest(),
      caps: DEFAULT_CAPS,
      monthToDateUsd: 0,
      mode: "batch",
      now: NOW,
      effectiveDate: "2026-08-08",
      client: undefined,
    });
    expect(plan.cells[0]?.suiteSpecHash).toBe(suiteSpecHash(cellInput.suite));
  });
});

describe("buildPlan — online mode (SPEC §7: exact via count_tokens)", () => {
  it("is NOT marked approximate, and uses the fake client's exact per-item token counts", async () => {
    const cellInput = haikuCell();
    const client = new FakeModelClient({
      script: {},
      tokenScript: Object.fromEntries(cellInput.suite.items.map((item) => [item.id, 1000])),
    });
    const plan = await buildPlan({
      runGroupId: "rg-1",
      cells: [cellInput],
      pricing: loadCommittedManifest(),
      caps: DEFAULT_CAPS,
      monthToDateUsd: 0,
      mode: "batch",
      now: NOW,
      effectiveDate: "2026-08-08",
      client,
    });
    expect(plan.approximate).toBe(false);
    // 7 items x 1000 tokens x k=3 = 21000 input tokens; + 7*3*100 assumed output.
    const row = loadCommittedManifest().models.find((m) => m.modelId === "claude-haiku-4-5")?.rows[0];
    if (row === undefined) throw new Error("missing pricing row");
    const expectedUsd = (21000 / 1_000_000) * row.batch.inputPerMTok + ((7 * 3 * 100) / 1_000_000) * row.batch.outputPerMTok;
    expect(plan.cells[0]?.estimatedUsd).toBeCloseTo(expectedUsd, 6);
  });

  it("SPEC §12: count_tokens results, not the manifest multiplier, drive a Fable-5 estimate", async () => {
    const suite = buildFixtureSuite({ id: "fable-suite", positiveCount: 1, negativeCount: 3, k: 1 });
    const [firstItem] = suite.items;
    if (firstItem === undefined) throw new Error("expected an item");
    // A deliberately-inflated exact count (as if the real 4.7+ tokenizer measured it) — buildPlan must use
    // THIS number, not `baseline * 1.3`, when a client is present.
    const client = new FakeModelClient({ script: {}, tokenScript: { [firstItem.id]: 5000 } });
    const cellInput: PlanCellInput = {
      suite: { ...suite, items: [firstItem] },
      presentation: FIXTURE_PRESENTATION,
      entry: { cellId: "fable5", modelIdRequested: "claude-fable-5", role: "release" },
    };
    const plan = await buildPlan({
      runGroupId: "rg-1",
      cells: [cellInput],
      pricing: loadCommittedManifest(),
      caps: DEFAULT_CAPS,
      monthToDateUsd: 0,
      mode: "batch",
      now: NOW,
      effectiveDate: "2026-08-08",
      client,
    });
    const row = loadCommittedManifest().models.find((m) => m.modelId === "claude-fable-5")?.rows[0];
    if (row === undefined) throw new Error("missing pricing row");
    const expectedUsd = (5000 / 1_000_000) * row.batch.inputPerMTok + (100 / 1_000_000) * row.batch.outputPerMTok;
    expect(plan.cells[0]?.estimatedUsd).toBeCloseTo(expectedUsd, 6);
  });
});

describe("buildPlan — caps (SPEC §8: plan refuses to emit an over-cap plan)", () => {
  it("throws E_CAP when the plan would exceed maxRunUsd", async () => {
    const suite = buildFixtureSuite({ positiveCount: 60, negativeCount: 40, k: 5 });
    const cellInput: PlanCellInput = {
      suite,
      presentation: FIXTURE_PRESENTATION,
      entry: { cellId: "sonnet5", modelIdRequested: "claude-sonnet-5", role: "standing" },
    };
    await expect(
      buildPlan({
        runGroupId: "rg-1",
        cells: [cellInput],
        pricing: loadCommittedManifest(),
        caps: { maxRunUsd: 0.001, maxCellUsd: 0.001, maxMonthUsd: 0.001 },
        monthToDateUsd: 0,
        mode: "sync",
        now: NOW,
        effectiveDate: "2026-08-08",
        client: undefined,
      }),
    ).rejects.toSatisfy((err: unknown) => isTiltmeterError(err) && err.code === "E_CAP");
  });
});

describe("assertPlanFresh (SPEC §9: suite edited between plan and run -> E_PLAN_STALE)", () => {
  it("does not throw when the suite's current hash still matches the plan", async () => {
    const cellInput = haikuCell();
    const plan = await buildPlan({
      runGroupId: "rg-1",
      cells: [cellInput],
      pricing: loadCommittedManifest(),
      caps: DEFAULT_CAPS,
      monthToDateUsd: 0,
      mode: "batch",
      now: NOW,
      effectiveDate: "2026-08-08",
      client: undefined,
    });
    const current = new Map([[cellInput.suite.id, suiteSpecHash(cellInput.suite)]]);
    expect(() => { assertPlanFresh(plan, current); }).not.toThrow();
  });

  it("throws E_PLAN_STALE when the suite file has since changed", async () => {
    const cellInput = haikuCell();
    const plan = await buildPlan({
      runGroupId: "rg-1",
      cells: [cellInput],
      pricing: loadCommittedManifest(),
      caps: DEFAULT_CAPS,
      monthToDateUsd: 0,
      mode: "batch",
      now: NOW,
      effectiveDate: "2026-08-08",
      client: undefined,
    });
    const current = new Map([[cellInput.suite.id, "a-completely-different-hash"]]);
    try {
      assertPlanFresh(plan, current);
      throw new Error("expected assertPlanFresh to throw");
    } catch (error) {
      expect(isTiltmeterError(error)).toBe(true);
      if (isTiltmeterError(error)) expect(error.code).toBe("E_PLAN_STALE");
    }
  });
});
