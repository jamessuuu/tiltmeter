/**
 * Reading schema (SPEC §3.3) — one per cell (suite × model execution).
 * Zod at every boundary: a reading file is validated on read, never
 * trusted, whether it came from this run or was checked out of git
 * history by `compare`/`verify`.
 */
import { z } from "zod";

export const ReadingAxesSchema = z.object({
  suiteSpecHash: z.string().min(1),
  modelIdRequested: z.string().min(1),
  modelIdResolved: z.string().min(1),
  aliasUsed: z.boolean(),
  runnerBehaviorVersion: z.number().int().nonnegative(),
  presentationHash: z.string().min(1),
  samplingPolicyHash: z.string().min(1),
});
export type ReadingAxes = z.infer<typeof ReadingAxesSchema>;

/** The five elements that define a cell's identity (SPEC §4). A subset of ReadingAxes. */
export const AXIS_TUPLE_KEYS = [
  "suiteSpecHash",
  "modelIdResolved",
  "runnerBehaviorVersion",
  "presentationHash",
  "samplingPolicyHash",
] as const;
export type AxisTupleKey = (typeof AXIS_TUPLE_KEYS)[number];
export type AxisTuple = Pick<ReadingAxes, AxisTupleKey>;

export function axisTupleOf(axes: ReadingAxes): AxisTuple {
  return {
    suiteSpecHash: axes.suiteSpecHash,
    modelIdResolved: axes.modelIdResolved,
    runnerBehaviorVersion: axes.runnerBehaviorVersion,
    presentationHash: axes.presentationHash,
    samplingPolicyHash: axes.samplingPolicyHash,
  };
}

export const TrialOutcomeSchema = z.enum(["pass", "fail", "noResult"]);
export type TrialOutcome = z.infer<typeof TrialOutcomeSchema>;

export const TrialSchema = z.object({
  attempt: z.number().int().positive(),
  outcome: TrialOutcomeSchema,
  firstTool: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  stopReason: z.string().optional(),
  usage: z.object({ in: z.number().int().nonnegative(), out: z.number().int().nonnegative() }).optional(),
  /** SPEC §9: why a trial is noResult (429/529 exhausted retries, truncation, …). */
  noResultReason: z.string().optional(),
});
export type Trial = z.infer<typeof TrialSchema>;

export const ItemReadingSchema = z.object({
  id: z.string().min(1),
  k: z.number().int().positive(),
  passes: z.number().int().nonnegative(),
  trials: z.array(TrialSchema),
});
export type ItemReading = z.infer<typeof ItemReadingSchema>;

/**
 * SPEC §9: "denominator is always items × k — missing trials are never
 * dropped." `error` is reserved for a distinct execution-error class the
 * real Anthropic client (M4) may need to separate from a retried-out
 * `noResult`; it is always 0 through M3, where every unscoreable trial is
 * uniformly `noResult`.
 */
export const CompletenessSchema = z.object({
  expectedTrials: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  noResult: z.number().int().nonnegative(),
});
export type Completeness = z.infer<typeof CompletenessSchema>;

/** SPEC §9: any noResult > 0 => "partial"; a cap trip => "aborted"; no key / suite unreachable => "skipped" (M4/M7). */
export const ReadingStatusSchema = z.enum(["complete", "partial", "aborted", "skipped"]);
export type ReadingStatus = z.infer<typeof ReadingStatusSchema>;

export const ReadingSchema = z.object({
  formatVersion: z.literal(1),
  runGroupId: z.string().min(1),
  cellId: z.string().min(1),
  axes: ReadingAxesSchema,
  harnessCommit: z.string().min(1),
  runnerVersion: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  status: ReadingStatusSchema,
  completeness: CompletenessSchema,
  metrics: z.record(z.string(), z.number()),
  items: z.array(ItemReadingSchema),
  /** sha256 of the canonicalized reading with `bodyHash` itself excluded (same shape as suiteSpecHash's `docs` exclusion). */
  bodyHash: z.string().min(1),
});
export type Reading = z.infer<typeof ReadingSchema>;

export function parseReading(data: unknown): Reading {
  return ReadingSchema.parse(data);
}
