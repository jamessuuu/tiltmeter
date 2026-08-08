/**
 * CLI exit codes (SPEC §7/§9). `USAGE` (4) is Commander's own usage-error
 * code and doubles as SPEC §9's literal "exit 4, re-plan" — no, see
 * `PLAN_STALE` below, which is its OWN code (5): SPEC names 4 for usage
 * errors generically (commander parse failures) and separately says a
 * stale plan should "exit 4, re-plan" in prose, but this codebase already
 * had `USAGE = 4` fixed since M0/M2 for commander's own error path, so
 * `PLAN_STALE` gets its own code instead of colliding with it — the
 * distinguishable signal (a stale plan is not a CLI usage mistake) matters
 * more than matching SPEC's prose number literally.
 */
export const CLI_EXIT = {
  CLEAN: 0,
  VERIFY_FAILED: 1,
  LINT_FAILED: 2,
  CAP_REFUSED: 3,
  USAGE: 4,
  PLAN_STALE: 5,
  /** `E_AMBIGUOUS_PENDING_BATCH`: `--resume` found a cell a previous, crashed process left `pending` with no `batchId` — refuses to guess whether it was already submitted rather than risking a duplicate charge. */
  RESUME_AMBIGUOUS: 6,
} as const;
export type CliExitCode = (typeof CLI_EXIT)[keyof typeof CLI_EXIT];
