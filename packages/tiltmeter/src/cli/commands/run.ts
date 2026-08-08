/**
 * `tiltmeter run` (SPEC §7/§9): executes a pinned `plan.json` against the
 * real client (or an injected fake in tests), submitting/collecting batch
 * cells, re-checking caps against ACTUAL usage after each cell, and
 * writing readings + `run.json` + an index-chain entry. `core/run-orchestrator.ts`
 * does the real work; this file is CLI wiring — argv/env/fs in, exit code
 * out.
 */
import { join } from "node:path";
import { assertPlanFresh, type Plan, type PlanCell } from "../../core/plan.js";
import { monthToDateUsd as computeMonthToDateUsd } from "../../core/caps.js";
import { appendEntry } from "../../core/index-chain.js";
import { isTiltmeterError } from "../../core/errors.js";
import type { ModelClient } from "../../core/model-client.js";
import type { RunRecord, RunRecordCell } from "../../core/batch.js";
import { executeRunGroup, type RunGroupCellInput } from "../../core/run-orchestrator.js";
import { RUNNER_BEHAVIOR_VERSION, TILTMETER_VERSION } from "../../core/version.js";
import {
  currentSuiteSpecHashes,
  readIndexChain,
  readPlanFile,
  readPresentation,
  readPricingManifest,
  readRunRecord,
  readSuite,
  writeIndexChain,
  writeReadingFile,
  writeRunRecord,
} from "../../node/observatory.js";
import type { CliIo } from "../run.js";
import { CLI_EXIT } from "../exit-codes.js";

export interface RunCommandOptions {
  runGroupId: string;
  resume: boolean;
  /** Overrides the plan's own baked-in mode; must match every cell's mode if given. */
  mode: "batch" | "sync" | undefined;
}

export interface RunCommandDeps {
  cwd: string;
  now: () => string;
  env: Record<string, string | undefined>;
  buildClient?: (apiKey: string) => ModelClient;
  harnessCommit: string;
}

function monthOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

function terminalStatus(status: RunRecordCell["status"] | undefined): boolean {
  return status === "complete" || status === "aborted" || status === "unavailable";
}

function planModeOf(plan: Plan): "batch" | "sync" {
  const [first] = plan.cells;
  return first?.mode ?? "batch";
}

/** Fold one cell's latest state into a full `RunRecord` — the `onCellUpdate` hook's job, so `run.json` is persisted incrementally between cells (crash-safety) rather than only once at the very end. */
function mergeCellIntoRecord(
  existing: RunRecord | undefined,
  runGroupId: string,
  plan: Plan,
  updatedCell: RunRecordCell,
): RunRecord {
  const cells = existing === undefined ? [] : [...existing.cells];
  const i = cells.findIndex((c) => c.suiteId === updatedCell.suiteId && c.cellId === updatedCell.cellId);
  if (i === -1) cells.push(updatedCell);
  else cells[i] = updatedCell;
  return {
    formatVersion: 1,
    runGroupId,
    planSuiteSpecHashes: Object.fromEntries(plan.cells.map((c) => [c.suiteId, c.suiteSpecHash])),
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    cells,
    costUsdSoFar: cells.reduce((sum, c) => sum + (c.actualUsd ?? 0), 0),
  };
}

export async function runRunCommand(io: CliIo, options: RunCommandOptions, deps: RunCommandDeps): Promise<number> {
  const observatoryDir = join(deps.cwd, "observatory");
  const nowIso = deps.now();

  const plan = readPlanFile(observatoryDir, options.runGroupId);
  if (plan === undefined) {
    io.stderr(`tiltmeter run: no plan.json found for run group "${options.runGroupId}" — run \`tiltmeter plan\` first`);
    return CLI_EXIT.USAGE;
  }

  const existingRunRecord = readRunRecord(observatoryDir, options.runGroupId);
  if (options.resume && existingRunRecord === undefined) {
    io.stderr(`tiltmeter run --resume: no run.json found for "${options.runGroupId}" — nothing to resume`);
    return CLI_EXIT.USAGE;
  }
  if (!options.resume && existingRunRecord !== undefined) {
    io.stderr(`tiltmeter run: a run.json already exists for "${options.runGroupId}" — use --resume instead of starting fresh`);
    return CLI_EXIT.USAGE;
  }

  try {
    assertPlanFresh(plan, currentSuiteSpecHashes(observatoryDir));
  } catch (error) {
    if (isTiltmeterError(error) && error.code === "E_PLAN_STALE") {
      io.stderr(`tiltmeter run: ${error.message}`);
      return CLI_EXIT.PLAN_STALE;
    }
    throw error;
  }

  const mode = options.mode ?? planModeOf(plan);
  if (!plan.cells.every((c) => c.mode === mode)) {
    io.stderr(`tiltmeter run: --${mode} does not match plan.json's own per-cell mode — re-plan with the mode you want to run`);
    return CLI_EXIT.USAGE;
  }

  // SPEC §9 "API key missing/invalid: exits before spending, writes
  // skipped with reason, commits." No reading is attempted at all.
  const apiKey = deps.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    const chain = readIndexChain(observatoryDir);
    const entry = appendEntry(chain, {
      runGroupId: options.runGroupId,
      at: nowIso,
      harnessCommit: deps.harnessCommit,
      runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
      cells: [],
      status: "skipped",
      costUsd: 0,
      reason: "ANTHROPIC_API_KEY not set",
    });
    writeIndexChain(observatoryDir, [...chain, entry]);
    io.stderr("tiltmeter run: ANTHROPIC_API_KEY not set — skipped before spending anything (recorded, never a silent gap)");
    return CLI_EXIT.CLEAN;
  }
  if (deps.buildClient === undefined) {
    io.stderr("tiltmeter run: no client available to execute trials");
    return CLI_EXIT.USAGE;
  }
  const client = deps.buildClient(apiKey);

  const pendingCells: RunGroupCellInput[] = [];
  for (const planCell of plan.cells) {
    const existingCell = existingRunRecord?.cells.find((c) => c.suiteId === planCell.suiteId && c.cellId === planCell.cellId);
    if (terminalStatus(existingCell?.status)) continue; // already done — never rebuilt, never resubmitted
    const suite = readSuite(observatoryDir, planCell.suiteId);
    const presentation = readPresentation(observatoryDir, suite.presentation);
    pendingCells.push({
      suite,
      presentation,
      entry: { cellId: planCell.cellId, modelIdRequested: planCell.modelIdRequested, role: "standing" },
      planCell,
    });
  }

  if (pendingCells.length === 0) {
    io.stdout(`tiltmeter run: every cell in "${options.runGroupId}" is already complete — nothing to do`);
    return CLI_EXIT.CLEAN;
  }

  const monthToDateUsd = computeMonthToDateUsd(readIndexChain(observatoryDir), monthOf(nowIso));
  const pricing = readPricingManifest(observatoryDir, plan.pricingManifestId);

  const result = await executeRunGroup({
    runGroupId: options.runGroupId,
    harnessCommit: deps.harnessCommit,
    runnerVersion: TILTMETER_VERSION,
    runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
    mode,
    caps: plan.caps,
    monthToDateUsd,
    pricing,
    effectiveDate: nowIso.slice(0, 10),
    now: deps.now,
    client,
    cells: pendingCells,
    existingRunRecord,
    onCellUpdate: (cell) => {
      writeRunRecord(observatoryDir, mergeCellIntoRecord(existingRunRecord, options.runGroupId, plan, cell));
    },
  });

  for (const reading of result.readings) writeReadingFile(observatoryDir, reading);
  writeRunRecord(observatoryDir, result.runRecord);

  const chain = readIndexChain(observatoryDir);
  const overallStatus =
    result.runRecord.abortedBy !== undefined
      ? "aborted"
      : result.readings.some((r) => r.status !== "complete")
        ? "partial"
        : "complete";
  const entry = appendEntry(chain, {
    runGroupId: options.runGroupId,
    at: deps.now(),
    harnessCommit: deps.harnessCommit,
    runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
    cells: result.readings.map((r) => ({ suiteId: r.suiteId, cellId: r.cellId, bodyHash: r.bodyHash })),
    status: overallStatus,
    costUsd: result.runRecord.costUsdSoFar,
    ...(result.runRecord.abortedBy !== undefined ? { reason: "spend cap reached mid-run" } : {}),
  });
  writeIndexChain(observatoryDir, [...chain, entry]);

  io.stdout(
    `tiltmeter run: "${options.runGroupId}" ${overallStatus} — ${String(result.readings.length)} reading(s), ` +
      `$${result.runRecord.costUsdSoFar.toFixed(4)} actual`,
  );
  for (const reading of result.readings) {
    io.stdout(`  ${reading.suiteId} x ${reading.cellId}: ${reading.status} (${String(activeItemCountFor(plan, reading.suiteId))} items)`);
  }
  return CLI_EXIT.CLEAN;
}

function activeItemCountFor(plan: Plan, suiteId: string): number {
  const cell = plan.cells.find((c: PlanCell) => c.suiteId === suiteId);
  return cell?.itemCount ?? 0;
}
