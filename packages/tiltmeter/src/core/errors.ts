/**
 * Typed error taxonomy (SPEC §13 acceptance criterion: "typed error
 * taxonomy … no provider strings echoed"). Defined in full at M0 so the
 * shape is fixed; most codes come into active use at their owning
 * milestone (noted below) rather than all at once.
 */
export type ErrorCode =
  /** M7 — a runner/console spend cap was reached; the reading is written `aborted`, never silently skipped. */
  | "E_CAP"
  /** M4/M7 — `plan.json` pins a suiteSpecHash that no longer matches the suite file; re-plan required. */
  | "E_PLAN_STALE"
  /** M2 — a comparison spans more than one varying axis element; see `reasons[]` on the Comparison for which. */
  | "E_AXIS_CONFLICT"
  /** M2 — a reading with noResult > 0 (`status: "partial"`) was used in an aggregate; partial readings are excluded. */
  | "E_PARTIAL"
  /** M5 — a suite artifact has no `source.origin` (provenance level); guessing is never permitted (SPEC §3.1 Decision 1). */
  | "E_PROVENANCE"
  /** M5 — a suite item's canonical bytes changed in place instead of being retired (SPEC §3.1 Decision 2). */
  | "E_IMMUTABLE_ITEM"
  /** M4 — a model provider request failed; the error is reported by class only, never the raw provider string/body. */
  | "E_PROVIDER";

export class TiltmeterError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TiltmeterError";
    this.code = code;
  }
}

export function isTiltmeterError(value: unknown): value is TiltmeterError {
  return value instanceof TiltmeterError;
}
