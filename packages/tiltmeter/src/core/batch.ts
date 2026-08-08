/**
 * Batch orchestration (SPEC §9): deterministic `custom_id`s recorded before
 * submission (`preparePendingCell` — pure, no network call, meant to be
 * persisted by the caller BEFORE `submitCellBatch` is ever invoked), the
 * duplicate-spend guard (`run --resume` never resubmits a cell with a
 * recorded batch id), a refusal signal for the one gap that guard alone
 * cannot close (`isAmbiguousPending` — a cell left `pending` with no
 * `batchId` by a process that may have crashed mid-submission), and the
 * one-retry-of-the-failed-subset rule for a batch that partially
 * expires/errors. `core/run.ts`'s `buildReadingFromTrials` does the actual
 * reading assembly; this module's job is purely the batch protocol around
 * it — prepare, submit, poll, collect, retry-once, map back to
 * `(itemId, attempt)`.
 */
import { z } from "zod";
import { sha256Hex } from "./sha256.js";
import type { BatchRequestItem, BatchResultItem, ModelClient, TrialResult } from "./model-client.js";
import type { RequestPlan } from "./model-client.js";

/**
 * SPEC §9: "deterministic `custom_id = sha256(runGroup,suite,item,trial)`
 * recorded BEFORE submitting" — the anchor the duplicate-spend guard and
 * the resume path both hang off. `trial` here is the k-repeat index
 * (1-based), matching `Trial.attempt` elsewhere in the schema.
 */
export function batchCustomId(runGroupId: string, suiteId: string, itemId: string, trial: number): string {
  return sha256Hex(`${runGroupId}:${suiteId}:${itemId}:${String(trial)}`);
}

/** All `(itemId, attempt)` custom ids for one cell, attempts `1..k`, item order preserved — computed once and reused by submission, result-mapping, and the retry-of-failed-subset pass. */
export function computeCellCustomIds(
  runGroupId: string,
  suiteId: string,
  itemIds: readonly string[],
  k: number,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const itemId of itemIds) {
    out[itemId] = Array.from({ length: k }, (_unused, i) => batchCustomId(runGroupId, suiteId, itemId, i + 1));
  }
  return out;
}

export const RunRecordCellStatusSchema = z.enum(["pending", "submitted", "complete", "aborted", "unavailable"]);
export type RunRecordCellStatus = z.infer<typeof RunRecordCellStatusSchema>;

export const RunRecordCellSchema = z.object({
  suiteId: z.string().min(1),
  cellId: z.string().min(1),
  modelIdRequested: z.string().min(1),
  mode: z.enum(["batch", "sync"]),
  /** itemId -> customId per attempt 1..k (SPEC §9: recorded before submission). */
  customIds: z.record(z.string(), z.array(z.string().min(1))),
  /**
   * Set once the provider accepts the batch. Its PRESENCE (not its value)
   * is the duplicate-spend guard: `hasRecordedBatch` below is the entire
   * rule `run --resume` checks before ever calling `client.submitBatch`
   * again for this cell.
   */
  batchId: z.string().optional(),
  /**
   * SPEC §9 "one retry of only the failed custom_id set … recorded as
   * attempt: 2": this project's `Trial.attempt` field already names the
   * k-repeat index (1..k), so overloading it for "which SUBMISSION attempt"
   * would collide two different meanings under one field. Deviation
   * (recorded here, not silently): a batch-level retry is tracked as its
   * own generation counter instead — `retriedCustomIds` is the exact
   * custom_id subset that failed on submission attempt 1 and was resent
   * once as submission attempt 2 (`retryBatchId`); a request's per-trial
   * `attempt` in the final reading is unaffected by which submission
   * generation produced its answer.
   */
  retriedCustomIds: z.array(z.string()).optional(),
  retryBatchId: z.string().optional(),
  status: RunRecordCellStatusSchema,
  actualUsd: z.number().nonnegative().optional(),
});
export type RunRecordCell = z.infer<typeof RunRecordCellSchema>;

export const RunRecordSchema = z.object({
  formatVersion: z.literal(1),
  runGroupId: z.string().min(1),
  /** suiteId -> the suiteSpecHash pinned by plan.json, carried alongside the run record for a resumed run's own re-freshness check. */
  planSuiteSpecHashes: z.record(z.string(), z.string()),
  startedAt: z.string().min(1),
  finishedAt: z.string().optional(),
  cells: z.array(RunRecordCellSchema),
  /** Running total of `actualUsd` across `complete`/`aborted` cells — SPEC §8's "re-checks against ACTUAL usage after each cell" reads this, not an estimate. */
  costUsdSoFar: z.number().nonnegative(),
  abortedBy: z.enum(["cap"]).optional(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export function parseRunRecord(data: unknown): RunRecord {
  return RunRecordSchema.parse(data);
}

/** SPEC §9's duplicate-spend guard, made literal: "a cell with a recorded batch id refuses a new submission." `run --resume` calls this before ever calling `client.submitBatch`. */
export function hasRecordedBatch(cell: Pick<RunRecordCell, "batchId">): boolean {
  return cell.batchId !== undefined;
}

/**
 * True for a cell a PREVIOUS process left `status: "pending"` with no
 * `batchId` — `customIds` were computed and (as of the fix below) persisted
 * before that process ever called `client.submitBatch`, but the process was
 * killed before it could persist the returned `batchId` (or before it ever
 * made the call at all). There is no way to tell those two cases apart
 * without a `batchId` to poll the provider with, so this is the signal
 * `core/run-orchestrator.ts` uses to refuse an automatic resubmission
 * rather than risk a duplicate charge.
 */
export function isAmbiguousPending(cell: Pick<RunRecordCell, "status" | "batchId">): boolean {
  return cell.status === "pending" && cell.batchId === undefined;
}

/**
 * Pure — computes a cell's deterministic `customId`s and returns a
 * `status: "pending"` record with NO network call. SPEC §9 / SECURITY.md's
 * "custom_id … written before submission": the caller persists this record
 * (via `onCellUpdate`) BEFORE ever calling `submitCellBatch`, so a crash
 * between "provider accepted the batch" and "batchId written to disk"
 * leaves an explicit, checkable `pending` record with the exact `customId`s
 * that may already be in flight — never nothing at all.
 */
export function preparePendingCell(
  runGroupId: string,
  suiteId: string,
  cellId: string,
  modelIdRequested: string,
  itemIds: readonly string[],
  k: number,
): RunRecordCell {
  const customIds = computeCellCustomIds(runGroupId, suiteId, itemIds, k);
  return { suiteId, cellId, modelIdRequested, mode: "batch", customIds, status: "pending" };
}

/**
 * Submit a cell's full batch (every active item × k attempts) UNLESS it
 * already has a recorded batch id (the guard above) — in which case the
 * existing record is returned completely unchanged and `client.submitBatch`
 * is never called. `existing` is normally the record `preparePendingCell`
 * just produced (its `customIds` are reused verbatim, never recomputed, so
 * the persisted-before-submit record and the one actually submitted can
 * never drift) — `existing === undefined` (or with no `customIds` of its
 * own) falls back to computing them here, which existing callers/tests rely
 * on.
 */
export async function submitCellBatch(
  client: ModelClient,
  runGroupId: string,
  suiteId: string,
  cellId: string,
  modelIdRequested: string,
  plans: readonly RequestPlan[],
  k: number,
  existing: RunRecordCell | undefined,
): Promise<RunRecordCell> {
  if (existing !== undefined && hasRecordedBatch(existing)) return existing;

  const itemIds = plans.map((p) => p.itemId);
  const customIds =
    existing !== undefined && Object.keys(existing.customIds).length > 0
      ? existing.customIds
      : computeCellCustomIds(runGroupId, suiteId, itemIds, k);
  const requests: BatchRequestItem[] = [];
  for (const plan of plans) {
    const ids = customIds[plan.itemId] ?? [];
    for (let attempt = 1; attempt <= k; attempt++) {
      const customId = ids[attempt - 1];
      if (customId === undefined) continue; // unreachable: computeCellCustomIds always emits k ids per item
      requests.push({ customId, plan });
    }
  }
  const { batchId } = await client.submitBatch(requests, modelIdRequested);
  return { suiteId, cellId, modelIdRequested, mode: "batch", customIds, batchId, status: "submitted" };
}

/** customId -> (itemId, attempt), the inverse of `computeCellCustomIds` — how a fetched batch result maps back onto the reading shape `core/run.ts` expects. */
function invertCustomIds(customIds: Record<string, string[]>): Map<string, { itemId: string; attempt: number }> {
  const out = new Map<string, { itemId: string; attempt: number }>();
  for (const [itemId, ids] of Object.entries(customIds)) {
    ids.forEach((customId, i) => out.set(customId, { itemId, attempt: i + 1 }));
  }
  return out;
}

export interface CollectBatchOutcome {
  /** itemId -> ordered TrialResult per attempt 1..k, ready for `buildReadingFromTrials`. */
  trialsByItem: Map<string, TrialResult[]>;
  /** Updated record — `retriedCustomIds`/`retryBatchId` set if a retry happened, `status: "complete"`. */
  cell: RunRecordCell;
}

/**
 * Poll a submitted cell's batch to completion, fetch its results, and —
 * SPEC §9's "batch expires (24h) / partially fails" row — retry EXACTLY
 * ONCE, and only the customIds that came back `noResult`, before accepting
 * whatever is left as final. A second `collectCellBatchResults` call on an
 * already-`retriedCustomIds` record does not retry again (idempotent —
 * `run --resume` calling this twice never double-submits).
 */
export async function collectCellBatchResults(
  client: ModelClient,
  cell: RunRecordCell,
): Promise<CollectBatchOutcome> {
  if (cell.batchId === undefined) {
    throw new Error("collectCellBatchResults: cell has no recorded batchId — submit it first");
  }
  await pollToEnd(client, cell.batchId);
  const results = await client.fetchBatchResults(cell.batchId);

  // A batch result carries enough to know WHICH request failed (its
  // customId) but not the request itself — `collectCellBatchResults` is
  // deliberately given no `plans` here, since the only thing SPEC §9's rule
  // needs at this point is the failed customId SET. Actually resending
  // those ids (which needs the plans) is `retryCellBatch`'s job, called
  // right after this by the same caller (`core/run-orchestrator.ts`), which
  // already has `plans` on hand from rendering the presentation once.
  const failedIds = results.filter((r) => r.result.outcome === "noResult").map((r) => r.customId);
  // A pending retry (SPEC §9's one retry) means this cell is not final yet
  // — leave `status: "submitted"` so the orchestrator knows to call
  // `retryCellBatch` next rather than treating partial results as done.
  // Already retried once (`cell.retriedCustomIds` already set on entry) or
  // nothing failed: this collection IS final.
  const alreadyRetried = cell.retriedCustomIds !== undefined;
  const needsRetry = failedIds.length > 0 && !alreadyRetried;
  const updated: RunRecordCell = needsRetry
    ? { ...cell, retriedCustomIds: [...failedIds], status: "submitted" }
    : { ...cell, status: "complete" };

  const inverse = invertCustomIds(cell.customIds);
  const trialsByItem = new Map<string, TrialResult[]>();
  for (const item of Object.keys(cell.customIds)) trialsByItem.set(item, []);
  for (const r of results) {
    const loc = inverse.get(r.customId);
    if (loc === undefined) continue; // defensive: a result for a customId this cell never submitted
    const arr = trialsByItem.get(loc.itemId);
    if (arr === undefined) continue;
    arr[loc.attempt - 1] = r.result;
  }

  return { trialsByItem, cell: updated };
}

async function pollToEnd(client: ModelClient, batchId: string): Promise<void> {
  // Bounded so a misbehaving fake/real client can never hang a test or a
  // real run forever; the real client's own poll cadence (sleep between
  // calls) lives in src/client — this loop only asks "ended yet?".
  for (let i = 0; i < 10_000; i++) {
    const { ended } = await client.pollBatch(batchId);
    if (ended) return;
  }
  throw new Error(`pollToEnd: batch "${batchId}" never reported ended`);
}

/**
 * SPEC §9's one retry, made concrete: resend ONLY `cell.retriedCustomIds`
 * (computed by `collectCellBatchResults` above) as a brand-new batch, using
 * the SAME deterministic customIds (not new ones — the point is resending
 * the identical requests, not creating new attempts), and merge whatever
 * comes back over the corresponding entries in `trialsByItem`. Call this
 * once, immediately after a `collectCellBatchResults` that set
 * `retriedCustomIds`; calling it again is a caller bug (there is no
 * `retriedCustomIds`-of-`retriedCustomIds` — the schema only tracks one
 * generation), guarded by `cell.retryBatchId` already being set.
 */
export async function retryCellBatch(
  client: ModelClient,
  cell: RunRecordCell,
  plans: readonly RequestPlan[],
  trialsByItem: Map<string, TrialResult[]>,
): Promise<{ trialsByItem: Map<string, TrialResult[]>; cell: RunRecordCell }> {
  if (cell.retriedCustomIds === undefined || cell.retriedCustomIds.length === 0) {
    return { trialsByItem, cell };
  }
  if (cell.retryBatchId !== undefined) return { trialsByItem, cell }; // already retried once — never twice

  const inverse = invertCustomIds(cell.customIds);
  const planByItemId = new Map(plans.map((p) => [p.itemId, p]));
  const retryRequests: BatchRequestItem[] = [];
  for (const customId of cell.retriedCustomIds) {
    const loc = inverse.get(customId);
    if (loc === undefined) continue;
    const plan = planByItemId.get(loc.itemId);
    if (plan === undefined) continue;
    retryRequests.push({ customId, plan });
  }
  if (retryRequests.length === 0) return { trialsByItem, cell };

  const { batchId: retryBatchId } = await client.submitBatch(retryRequests, cell.modelIdRequested);
  await pollToEnd(client, retryBatchId);
  const retryResults: BatchResultItem[] = await client.fetchBatchResults(retryBatchId);

  const merged = new Map(trialsByItem);
  for (const r of retryResults) {
    const loc = inverse.get(r.customId);
    if (loc === undefined) continue;
    const arr = merged.get(loc.itemId) ?? [];
    arr[loc.attempt - 1] = r.result;
    merged.set(loc.itemId, arr);
  }
  // The one retry SPEC §9 allows has now happened — whatever came back
  // (even if still `noResult`) is final; this cell is done.
  return { trialsByItem: merged, cell: { ...cell, retryBatchId, status: "complete" } };
}
