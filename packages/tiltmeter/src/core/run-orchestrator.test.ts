import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  allPassBehavior,
  buildFixtureSuite,
  FakeModelClient,
  FIXTURE_PRESENTATION,
  noResultTrial,
  scriptForBehavior,
} from "../testing/index.js";
import { parsePricingManifest, type PricingManifest } from "./pricing.js";
import { DEFAULT_CAPS } from "./caps.js";
import { buildPlan, type PlanCellInput } from "./plan.js";
import { executeRunGroup, type RunGroupCellInput } from "./run-orchestrator.js";
import { RUNNER_BEHAVIOR_VERSION, TILTMETER_VERSION } from "./version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function loadCommittedManifest(): PricingManifest {
  const raw = readFileSync(join(REPO_ROOT, "observatory", "pricing", "pricing.2026-08-08.json"), "utf8");
  return parsePricingManifest(JSON.parse(raw));
}

const NOW = () => "2026-08-08T00:00:00.000Z";

async function cellInputFor(planCellInput: PlanCellInput, client: FakeModelClient): Promise<RunGroupCellInput> {
  const plan = await buildPlan({
    runGroupId: "rg-1",
    cells: [planCellInput],
    pricing: loadCommittedManifest(),
    caps: DEFAULT_CAPS,
    monthToDateUsd: 0,
    mode: "batch",
    now: NOW,
    effectiveDate: "2026-08-08",
    client,
  });
  const planCell = plan.cells[0];
  if (planCell === undefined) throw new Error("expected a plan cell");
  return { suite: planCellInput.suite, presentation: planCellInput.presentation, entry: planCellInput.entry, planCell };
}

function baseOptions(mode: "batch" | "sync") {
  return {
    runGroupId: "rg-1",
    harnessCommit: "0000000000000000000000000000000000000",
    runnerVersion: TILTMETER_VERSION,
    runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
    mode,
    caps: DEFAULT_CAPS,
    monthToDateUsd: 0,
    pricing: loadCommittedManifest(),
    effectiveDate: "2026-08-08",
    now: NOW,
    existingRunRecord: undefined,
  };
}

describe("executeRunGroup — sync mode", () => {
  it("produces one complete reading per cell with cost attached", async () => {
    const suite = buildFixtureSuite({ positiveCount: 2, negativeCount: 3, k: 1 });
    const client = new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) });
    const cellInput = await cellInputFor(
      { suite, presentation: FIXTURE_PRESENTATION, entry: { cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" } },
      client,
    );

    const result = await executeRunGroup({ ...baseOptions("sync"), client, cells: [cellInput] });

    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]?.status).toBe("complete");
    expect(result.readings[0]?.cost?.mode).toBe("sync");
    expect(result.readings[0]?.cost?.actualUsd).toBeGreaterThanOrEqual(0);
    expect(result.runRecord.cells).toHaveLength(1);
    expect(result.runRecord.abortedBy).toBeUndefined();
  });
});

describe("executeRunGroup — batch mode + resume (SPEC §9 duplicate-spend guard)", () => {
  it("submits, collects, and attaches actual cost", async () => {
    const suite = buildFixtureSuite({ positiveCount: 2, negativeCount: 3, k: 1 });
    const client = new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) });
    const cellInput = await cellInputFor(
      { suite, presentation: FIXTURE_PRESENTATION, entry: { cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" } },
      client,
    );

    const result = await executeRunGroup({ ...baseOptions("batch"), client, cells: [cellInput] });
    expect(result.readings[0]?.status).toBe("complete");
    expect(result.runRecord.cells[0]?.batchId).toBeDefined();
  });

  it("resuming with a recorded batchId never resubmits (SPEC §9: 'a cell with a recorded batch id refuses a new submission')", async () => {
    const suite = buildFixtureSuite({ positiveCount: 2, negativeCount: 2, k: 1 });
    const client = new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) });
    const cellInput = await cellInputFor(
      { suite, presentation: FIXTURE_PRESENTATION, entry: { cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" } },
      client,
    );

    const first = await executeRunGroup({ ...baseOptions("batch"), client, cells: [cellInput] });

    let submitCount = 0;
    const originalSubmit = client.submitBatch.bind(client);
    client.submitBatch = (...args) => {
      submitCount++;
      return originalSubmit(...args);
    };
    const resumed = await executeRunGroup({
      ...baseOptions("batch"),
      client,
      cells: [cellInput],
      existingRunRecord: first.runRecord,
    });

    expect(submitCount).toBe(0);
    expect(resumed.readings[0]?.status).toBe("complete");
  });
});

describe("executeRunGroup — cap trip (SPEC §8: stop submitting, write aborted, never a silent skip)", () => {
  it("a mid-run cap breach aborts every subsequent cell without submitting them", async () => {
    const suiteA = buildFixtureSuite({ id: "suite-a", positiveCount: 2, negativeCount: 2, k: 1 });
    const suiteB = buildFixtureSuite({ id: "suite-b", positiveCount: 2, negativeCount: 2, k: 1 });
    const client = new FakeModelClient({
      script: { ...scriptForBehavior(suiteA, allPassBehavior()), ...scriptForBehavior(suiteB, allPassBehavior()) },
    });
    const cellA = await cellInputFor(
      { suite: suiteA, presentation: FIXTURE_PRESENTATION, entry: { cellId: "cell-a", modelIdRequested: "claude-haiku-4-5", role: "standing" } },
      client,
    );
    const cellB = await cellInputFor(
      { suite: suiteB, presentation: FIXTURE_PRESENTATION, entry: { cellId: "cell-b", modelIdRequested: "claude-haiku-4-5", role: "standing" } },
      client,
    );

    // A cap so tight that even the first (tiny, sync-cost) cell trips it.
    const tightCaps = { maxRunUsd: 0.0000001, maxCellUsd: 1.5, maxMonthUsd: 15 };
    let submitCount = 0;
    const originalSubmit = client.submitBatch.bind(client);
    client.submitBatch = (...args) => {
      submitCount++;
      return originalSubmit(...args);
    };

    const result = await executeRunGroup({ ...baseOptions("batch"), caps: tightCaps, client, cells: [cellA, cellB] });

    expect(result.runRecord.abortedBy).toBe("cap");
    expect(submitCount).toBe(1); // only cellA was ever submitted
    const readingB = result.readings.find((r) => r.suiteId === "suite-b");
    expect(readingB?.status).toBe("aborted");
    expect(readingB?.abortedBy).toBe("cap");
    // Never a silent skip: denominator still items x k, every trial noResult.
    expect(readingB?.completeness.expectedTrials).toBe(readingB?.completeness.noResult);
    expect(readingB?.completeness.expectedTrials).toBeGreaterThan(0);
  });
});

describe("executeRunGroup — model unavailable (SPEC §9: 404/retired)", () => {
  it("marks the reading status 'unavailable' rather than 'partial', and the run continues to the next cell", async () => {
    const suiteA = buildFixtureSuite({ id: "suite-a", positiveCount: 2, negativeCount: 2, k: 1 });
    const suiteB = buildFixtureSuite({ id: "suite-b", positiveCount: 1, negativeCount: 1, k: 1 });
    const script = {
      ...Object.fromEntries(suiteA.items.map((i) => [i.id, { 1: noResultTrial("model retired", { modelUnavailable: true }) }])),
      ...scriptForBehavior(suiteB, allPassBehavior()),
    };
    const client = new FakeModelClient({ script });
    const cellA = await cellInputFor(
      // A validly-priced model id can still come back 404/retired at RUN time — pricing-manifest lookup succeeds at plan time regardless.
      { suite: suiteA, presentation: FIXTURE_PRESENTATION, entry: { cellId: "cell-a", modelIdRequested: "claude-haiku-4-5", role: "standing" } },
      client,
    );
    const cellB = await cellInputFor(
      { suite: suiteB, presentation: FIXTURE_PRESENTATION, entry: { cellId: "cell-b", modelIdRequested: "claude-haiku-4-5", role: "standing" } },
      client,
    );

    const result = await executeRunGroup({ ...baseOptions("sync"), client, cells: [cellA, cellB] });

    const readingA = result.readings.find((r) => r.suiteId === "suite-a");
    const readingB = result.readings.find((r) => r.suiteId === "suite-b");
    expect(readingA?.status).toBe("unavailable");
    expect(readingB?.status).toBe("complete"); // run continued
  });
});
