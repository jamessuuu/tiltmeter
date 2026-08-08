/**
 * The scheduled-reading orchestrator (SPEC §8/§9 M7) — what `reading.yml`
 * actually invokes. NOT a documented `tiltmeter` subcommand (SPEC §7's CLI
 * table stays exactly as specified): this is internal wiring, reached only
 * via `scripts/reading-run.mjs`'s thin CI shim, the same "script imports
 * the compiled dist" shape as `scripts/calibration-report.mjs`.
 *
 * Its one job beyond `plan` + `run` themselves: guarantee the 60-day
 * auto-disable mitigation ("every scheduled run commits SOMETHING even
 * when it does nothing") holds for the one gap the existing `plan`/`run`
 * contract leaves open. `tiltmeter run` already writes a committed
 * `skipped` index entry when `ANTHROPIC_API_KEY` is missing (SPEC §9,
 * `cli/commands/run.ts`) — that path needs no new code, just correct
 * wiring. But `tiltmeter plan` REFUSES (`E_CAP`, exit `CAP_REFUSED`) and
 * writes NOTHING when the run would exceed a spend cap — appropriate for
 * an interactive caller, but it means a month already at its cap would
 * produce a scheduled run with no plan.json, no run.json, and (critically)
 * NO index-chain entry: a silent gap, not a recorded skip. This module
 * closes that gap with a cap PRE-CHECK, reusing `core/caps.ts`'s own
 * `checkCaps` (an empty `cellEstimatesUsd` array still exercises its
 * month-to-date-vs-cap comparison) — no new cap logic, just a new caller.
 */
import { join } from "node:path";
import { checkCaps, monthToDateUsd as computeMonthToDateUsd, DEFAULT_CAPS } from "../../core/caps.js";
import { appendEntry } from "../../core/index-chain.js";
import { RUNNER_BEHAVIOR_VERSION } from "../../core/version.js";
import { readIndexChain, writeIndexChain } from "../../node/observatory.js";
import { runPlanCommand, type PlanCommandDeps } from "./plan.js";
import { runRunCommand, type RunCommandDeps } from "./run.js";
import { CLI_EXIT } from "../exit-codes.js";
import type { CliIo } from "../run.js";

export interface ScheduledReadingOptions {
  runGroupId: string;
  mode: "batch" | "sync";
}

export interface ScheduledReadingDeps extends PlanCommandDeps, RunCommandDeps {}

function monthOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

/** Append a `status: "skipped"` index entry directly — never through `plan`/`run` — and write it. The one write path this module owns outright. */
function writeSkippedEntry(observatoryDir: string, deps: ScheduledReadingDeps, options: ScheduledReadingOptions, reason: string): void {
  const chain = readIndexChain(observatoryDir);
  const entry = appendEntry(chain, {
    runGroupId: options.runGroupId,
    at: deps.now(),
    harnessCommit: deps.harnessCommit,
    runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
    cells: [],
    status: "skipped",
    costUsd: 0,
    reason,
  });
  writeIndexChain(observatoryDir, [...chain, entry]);
}

/**
 * Run (or cleanly skip, always committing) one scheduled run group.
 * `deps.env.ANTHROPIC_API_KEY` missing is handled entirely inside
 * `runRunCommand` (already tested — SPEC §9); this function only adds the
 * plan-time cap preflight described above. Returns a `tiltmeter`-shaped
 * exit code (`CLI_EXIT`) — `CLEAN` covers BOTH "a reading happened" and
 * "cleanly skipped, recorded" outcomes, matching `run`'s own convention
 * (SPEC §8: never a silent skip, but also never a red CI job for an
 * ordinary, expected skip).
 */
export async function runScheduledReading(io: CliIo, options: ScheduledReadingOptions, deps: ScheduledReadingDeps): Promise<number> {
  const observatoryDir = join(deps.cwd, "observatory");
  const nowIso = deps.now();

  const preflightMonthToDateUsd = computeMonthToDateUsd(readIndexChain(observatoryDir), monthOf(nowIso));
  const preflight = checkCaps({ caps: DEFAULT_CAPS, monthToDateUsd: preflightMonthToDateUsd, cellEstimatesUsd: [] });
  if (!preflight.ok) {
    writeSkippedEntry(
      observatoryDir,
      deps,
      options,
      `monthly spend cap already reached before planning ($${preflightMonthToDateUsd.toFixed(2)} >= $${DEFAULT_CAPS.maxMonthUsd.toFixed(2)})`,
    );
    io.stdout(
      `tiltmeter (scheduled): monthly cap already reached — skipped before planning anything, recorded, never a silent gap`,
    );
    return CLI_EXIT.CLEAN;
  }

  const hasKey = deps.env.ANTHROPIC_API_KEY !== undefined && deps.env.ANTHROPIC_API_KEY.length > 0;
  const planCode = await runPlanCommand(
    io,
    { offline: !hasKey, mode: options.mode, runGroupId: options.runGroupId, suiteIds: undefined, date: undefined },
    deps,
  );

  if (planCode === CLI_EXIT.CAP_REFUSED) {
    // A race between the preflight above and plan's own (tighter, per-cell
    // and per-run) check — still a cap-reached skip, still committed.
    writeSkippedEntry(observatoryDir, deps, options, "plan refused: this run group would exceed a spend cap");
    io.stdout("tiltmeter (scheduled): plan refused on cap grounds — skipped, recorded, never a silent gap");
    return CLI_EXIT.CLEAN;
  }
  if (planCode !== CLI_EXIT.CLEAN) return planCode; // a genuine failure (bad config, no suites, …) — propagate and let CI go red

  return runRunCommand(io, { runGroupId: options.runGroupId, resume: false, mode: undefined }, deps);
}
