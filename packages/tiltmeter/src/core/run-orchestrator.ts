/**
 * Run-group orchestration (SPEC §7 `tiltmeter run`, §8 caps, §9 failure
 * contracts) — the layer that ties `core/run.ts` (reading assembly),
 * `core/batch.ts` (submit/collect/retry), `core/caps.ts` (the actual-usage
 * re-check), and `core/pricing.ts` (actual cost) into one sequential pass
 * over a run group's cells. Still core: no filesystem, no `Date.now`, no
 * git. The CLI layer (`src/cli/commands/run.ts`) owns reading/writing
 * `observatory/**`, filtering out already-`complete` cells before a resume
 * call (so a finished cell's reading — and its bodyHash/timestamps — is
 * never rebuilt), and turning `onCellUpdate` into an actual file write for
 * crash-safety between cells.
 */
import { activeItems, type Suite } from "./suite.js";
import { renderPresentation, type Presentation } from "./presentation.js";
import type { ModelClient } from "./model-client.js";
import type { Reading } from "./reading.js";
import {
  attachReadingCost,
  buildNeverAttemptedAbortedReading,
  buildReadingFromTrials,
  runSuite,
  type RunContext,
} from "./run.js";
import {
  collectCellBatchResults,
  retryCellBatch,
  submitCellBatch,
  type RunRecord,
  type RunRecordCell,
} from "./batch.js";
import { capBreachAfterCell, type Caps } from "./caps.js";
import { priceUsage, selectPricingRow, type PricingManifest } from "./pricing.js";
import type { PanelEntry, PlanCell } from "./plan.js";

export interface RunGroupCellInput {
  suite: Suite;
  presentation: Presentation;
  entry: PanelEntry;
  planCell: PlanCell;
}

export interface RunGroupOptions {
  runGroupId: string;
  harnessCommit: string;
  runnerVersion: string;
  runnerBehaviorVersion: number;
  mode: "batch" | "sync";
  caps: Caps;
  /** Committed month-to-date BEFORE this run started (SPEC §8). */
  monthToDateUsd: number;
  pricing: PricingManifest;
  effectiveDate: string;
  now: () => string;
  client: ModelClient;
  cells: RunGroupCellInput[];
  /** A prior partial run's record (SPEC §9 `--resume`) — its `cells` are consulted for already-`submitted` batch ids (never resubmitted) and its `costUsdSoFar` seeds the cap re-check; `undefined` for a fresh run. Cells the CALLER has already determined are fully `complete` should not appear in `options.cells` at all (see file header). */
  existingRunRecord: RunRecord | undefined;
  /** Called after every meaningful state change to a cell's run record (submit, collect, retry, final cost/abort) — the CLI layer's hook for crash-safe incremental persistence. Never required for correctness of the returned result, only for resumability if THIS process itself is interrupted. */
  onCellUpdate?: (cell: RunRecordCell) => Promise<void> | void;
}

export interface RunGroupResult {
  readings: Reading[];
  runRecord: RunRecord;
}

function sumActualUsage(reading: Reading): { in: number; out: number } {
  let inTok = 0;
  let outTok = 0;
  for (const item of reading.items) {
    for (const trial of item.trials) {
      if (trial.usage === undefined) continue;
      inTok += trial.usage.in;
      outTok += trial.usage.out;
    }
  }
  return { in: inTok, out: outTok };
}

function buildCtx(cellInput: RunGroupCellInput, options: RunGroupOptions): RunContext {
  return {
    runGroupId: options.runGroupId,
    cellId: cellInput.entry.cellId,
    suiteSpecHash: cellInput.planCell.suiteSpecHash,
    presentationHash: cellInput.planCell.presentationHash,
    samplingPolicyHash: cellInput.planCell.samplingPolicyHash,
    runnerBehaviorVersion: options.runnerBehaviorVersion,
    modelIdRequested: cellInput.entry.modelIdRequested,
    harnessCommit: options.harnessCommit,
    runnerVersion: options.runnerVersion,
    now: options.now,
  };
}

function findExistingCell(
  existing: RunRecord | undefined,
  suiteId: string,
  cellId: string,
): RunRecordCell | undefined {
  return existing?.cells.find((c) => c.suiteId === suiteId && c.cellId === cellId);
}

async function notify(options: RunGroupOptions, cell: RunRecordCell): Promise<void> {
  await options.onCellUpdate?.(cell);
}

/**
 * Execute (or resume) one run group's cells, in order, stopping submission
 * the moment an ACTUAL-usage cap breach is detected (SPEC §8) — every cell
 * after that point becomes a never-attempted `aborted` reading rather than
 * a silent gap (SPEC §8: "never a silent skip").
 */
export async function executeRunGroup(options: RunGroupOptions): Promise<RunGroupResult> {
  const readings: Reading[] = [];
  const cellRecords: RunRecordCell[] = options.existingRunRecord === undefined ? [] : [...options.existingRunRecord.cells];
  let runSoFarUsd = options.existingRunRecord?.costUsdSoFar ?? 0;
  let capTripped = false;

  const upsertCellRecord = (record: RunRecordCell): void => {
    const i = cellRecords.findIndex((c) => c.suiteId === record.suiteId && c.cellId === record.cellId);
    if (i === -1) cellRecords.push(record);
    else cellRecords[i] = record;
  };

  for (const cellInput of options.cells) {
    const ctx = buildCtx(cellInput, options);

    if (capTripped) {
      const reading = buildNeverAttemptedAbortedReading(cellInput.suite, ctx, cellInput.planCell.k);
      readings.push(reading);
      const record: RunRecordCell = {
        suiteId: cellInput.suite.id,
        cellId: cellInput.entry.cellId,
        modelIdRequested: cellInput.entry.modelIdRequested,
        mode: options.mode,
        customIds: {},
        status: "aborted",
        actualUsd: 0,
      };
      upsertCellRecord(record);
      await notify(options, record);
      continue;
    }

    const items = activeItems(cellInput.suite);
    const k = cellInput.planCell.k;
    const startedAt = options.now();
    let reading: Reading;
    let cellRecord: RunRecordCell;

    if (options.mode === "sync") {
      reading = await runSuite(cellInput.suite, cellInput.presentation, options.client, ctx);
      cellRecord = {
        suiteId: cellInput.suite.id,
        cellId: cellInput.entry.cellId,
        modelIdRequested: cellInput.entry.modelIdRequested,
        mode: "sync",
        customIds: {},
        status: "complete",
      };
      upsertCellRecord(cellRecord);
      await notify(options, cellRecord);
    } else {
      const plans = renderPresentation(cellInput.suite, cellInput.presentation);
      const existing = findExistingCell(options.existingRunRecord, cellInput.suite.id, cellInput.entry.cellId);

      cellRecord = await submitCellBatch(
        options.client,
        options.runGroupId,
        cellInput.suite.id,
        cellInput.entry.cellId,
        cellInput.entry.modelIdRequested,
        plans,
        k,
        existing,
      );
      upsertCellRecord(cellRecord);
      await notify(options, cellRecord);

      let collected = await collectCellBatchResults(options.client, cellRecord);
      upsertCellRecord(collected.cell);
      await notify(options, collected.cell);

      if (collected.cell.retriedCustomIds !== undefined && collected.cell.retryBatchId === undefined) {
        const retried = await retryCellBatch(options.client, collected.cell, plans, collected.trialsByItem);
        collected = { trialsByItem: retried.trialsByItem, cell: retried.cell };
        upsertCellRecord(collected.cell);
        await notify(options, collected.cell);
      }

      const finishedAt = options.now();
      reading = buildReadingFromTrials(cellInput.suite, items, collected.trialsByItem, ctx, startedAt, finishedAt, k);
      cellRecord = collected.cell;
    }

    const usage = sumActualUsage(reading);
    const row = selectPricingRow(options.pricing, cellInput.entry.modelIdRequested, options.effectiveDate);
    const rate = options.mode === "batch" ? row.batch : row.standard;
    const actualUsd = priceUsage(usage, rate);
    reading = attachReadingCost(reading, {
      estimatedUsd: cellInput.planCell.estimatedUsd,
      actualUsd,
      pricingManifest: options.pricing.id,
      mode: options.mode,
    });
    readings.push(reading);

    const breach = capBreachAfterCell(
      { caps: options.caps, monthToDateUsd: options.monthToDateUsd, runSoFarUsd },
      actualUsd,
    );
    runSoFarUsd += actualUsd;
    if (breach !== undefined) capTripped = true;

    const finalRecord: RunRecordCell = {
      ...cellRecord,
      status: reading.status === "unavailable" ? "unavailable" : "complete",
      actualUsd,
    };
    upsertCellRecord(finalRecord);
    await notify(options, finalRecord);
  }

  const runRecord: RunRecord = {
    formatVersion: 1,
    runGroupId: options.runGroupId,
    planSuiteSpecHashes: Object.fromEntries(options.cells.map((c) => [c.suite.id, c.planCell.suiteSpecHash])),
    startedAt: options.existingRunRecord?.startedAt ?? options.now(),
    finishedAt: options.now(),
    cells: cellRecords,
    costUsdSoFar: runSoFarUsd,
    ...(capTripped ? { abortedBy: "cap" as const } : {}),
  };

  return { readings, runRecord };
}
