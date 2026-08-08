/**
 * `tiltmeter plan` (SPEC §7): builds the run matrix, computes a cost
 * estimate (exact via `count_tokens` per model, or `--offline`'s
 * heuristic), cap-checks it, and writes `plan.json`. This file is the CLI
 * wiring only — `core/plan.ts`'s `buildPlan` does the real work; this
 * reads `observatory/**` off disk (`src/node/observatory.ts`) and turns
 * the result into stdout lines + exit codes.
 */
import { join } from "node:path";
import { buildPlan, hasNullPair, type PlanCellInput } from "../../core/plan.js";
import { monthToDateUsd as computeMonthToDateUsd } from "../../core/caps.js";
import { isTiltmeterError } from "../../core/errors.js";
import type { ModelClient } from "../../core/model-client.js";
import {
  readAllSuites,
  readIndexChain,
  readPanel,
  readPresentation,
  readPricingManifest,
  writePlanFile,
} from "../../node/observatory.js";
import type { CliIo } from "../run.js";
import { CLI_EXIT } from "../exit-codes.js";

export interface PlanCommandOptions {
  offline: boolean;
  mode: "batch" | "sync";
  runGroupId: string;
  suiteIds: string[] | undefined;
  /** `YYYY-MM-DD` — defaults to `deps.now()` truncated. Exposed for tests/reproducibility, not a documented flag SPEC names, but harmless to allow. */
  date: string | undefined;
}

export interface PlanCommandDeps {
  cwd: string;
  now: () => string;
  env: Record<string, string | undefined>;
  /** `undefined` in `--offline` mode. Built from `ANTHROPIC_API_KEY` by the caller when present; injectable so tests never construct a real network client. */
  buildClient?: (apiKey: string) => ModelClient;
}

function monthOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export async function runPlanCommand(io: CliIo, options: PlanCommandOptions, deps: PlanCommandDeps): Promise<number> {
  const observatoryDir = join(deps.cwd, "observatory");
  const nowIso = deps.now();
  const effectiveDate = options.date ?? nowIso.slice(0, 10);

  const allSuites = readAllSuites(observatoryDir);
  const suites = options.suiteIds === undefined ? allSuites : allSuites.filter((s) => options.suiteIds?.includes(s.id));
  if (suites.length === 0) {
    io.stderr("tiltmeter plan: no suites found under observatory/suites/ (or --suites matched none)");
    return CLI_EXIT.USAGE;
  }

  const panel = readPanel(observatoryDir);
  if (!hasNullPair(panel)) {
    io.stderr("tiltmeter plan: observatory/panel.json has no valid null pair (SPEC §4: mandatory negative control)");
    return CLI_EXIT.USAGE;
  }

  const cells: PlanCellInput[] = [];
  for (const suite of suites) {
    const presentation = readPresentation(observatoryDir, suite.presentation);
    for (const entry of panel.entries) {
      cells.push({ suite, presentation, entry });
    }
  }

  let client: ModelClient | undefined;
  if (!options.offline) {
    const apiKey = deps.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      io.stderr(
        "tiltmeter plan: ANTHROPIC_API_KEY is not set — count_tokens needs an authenticated (though free) call. " +
          "Pass --offline to plan without a key (the estimate will be marked approximate).",
      );
      return CLI_EXIT.USAGE;
    }
    if (deps.buildClient === undefined) {
      io.stderr("tiltmeter plan: no client available to call count_tokens");
      return CLI_EXIT.USAGE;
    }
    client = deps.buildClient(apiKey);
  }

  const pricing = readPricingManifest(observatoryDir);
  const monthToDateUsd = computeMonthToDateUsd(readIndexChain(observatoryDir), monthOf(nowIso));

  try {
    const plan = await buildPlan({
      runGroupId: options.runGroupId,
      cells,
      pricing,
      caps: { maxRunUsd: 3.0, maxCellUsd: 1.5, maxMonthUsd: 15.0 },
      monthToDateUsd,
      mode: options.mode,
      now: deps.now,
      effectiveDate,
      client,
    });
    writePlanFile(observatoryDir, plan);
    io.stdout(
      `tiltmeter plan: wrote observatory/readings/${plan.runGroupId}/plan.json — ` +
        `${String(plan.cells.length)} cell(s), estimated $${plan.totalEstimatedUsd.toFixed(4)}` +
        (plan.approximate ? " (approximate — built --offline)" : ""),
    );
    for (const cell of plan.cells) {
      io.stdout(`  ${cell.suiteId} x ${cell.cellId} (${cell.modelIdRequested}): $${cell.estimatedUsd.toFixed(4)}`);
    }
    return CLI_EXIT.CLEAN;
  } catch (error) {
    if (isTiltmeterError(error) && error.code === "E_CAP") {
      io.stderr(`tiltmeter plan: ${error.message}`);
      return CLI_EXIT.CAP_REFUSED;
    }
    throw error;
  }
}
