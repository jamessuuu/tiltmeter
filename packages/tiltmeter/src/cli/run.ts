/**
 * The `tiltmeter` CLI program (SPEC §7). `runCli` is the testable core:
 * argv in, exit code out, all I/O through the injected `io`/`env` — the
 * only place in the codebase that touches `process.exit` / env / cwd is
 * `src/cli/index.ts` (the bin), which just forwards real argv/streams/env
 * here (mirrors snapgauge's `runCli` shape).
 *
 * M0/M1: the program shell + version/help only. M2 added `verify`. M4 added
 * `plan` and `run` — both accept an optional `deps.buildClient` (defaults
 * to the real `AnthropicModelClient`) so tests inject a `FakeModelClient`
 * and stay at $0 with zero network (SPEC §9/§12: "NO live smoke run", "NO
 * network in tests"). M5 adds `lint`. M8 adds `init` (scaffolding — SPEC
 * §7/§14). `compare` and `report` remain post-v1 territory.
 */
import { Command } from "commander";
import { TILTMETER_VERSION } from "../core/version.js";
import type { ModelClient } from "../core/model-client.js";
import { AnthropicModelClient } from "../client/anthropic.js";
import { runVerify } from "./verify.js";
import { runPlanCommand, type PlanCommandOptions } from "./commands/plan.js";
import { runRunCommand, type RunCommandOptions } from "./commands/run.js";
import { runLintCommand, type LintCommandOptions } from "./commands/lint.js";
import { runInitCommand, type InitCommandOptions } from "./commands/init.js";
import { CLI_EXIT } from "./exit-codes.js";

export { CLI_EXIT } from "./exit-codes.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliEnv {
  cwd: string;
  env: Record<string, string | undefined>;
}

/** Test-only dependency injection point — every field defaults to the real thing (a real client, a real clock). Never constructed by `src/cli/index.ts` (the bin), which always uses the defaults. */
export interface CliDeps {
  now?: () => string;
  buildClient?: (apiKey: string) => ModelClient;
  harnessCommit?: string;
}

/** Signals a specific process exit code from inside a Commander action, distinct from commander's own usage-error path (always `CLI_EXIT.USAGE`). */
class CliExitError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super(`cli exit ${String(exitCode)}`);
    this.name = "CliExitError";
    this.exitCode = exitCode;
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultBuildClient(apiKey: string): ModelClient {
  return new AnthropicModelClient({ apiKey });
}

function buildProgram(io: CliIo, env: CliEnv, deps: Required<CliDeps>): Command {
  const program = new Command();
  program
    .name("tiltmeter")
    .description(
      "Tell an operator when a new model release moves their agent harness off true.",
    )
    .version(TILTMETER_VERSION, "-v, --version")
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        io.stdout(str.replace(/\n$/, ""));
      },
      writeErr: (str) => {
        io.stderr(str.replace(/\n$/, ""));
      },
    });

  program
    .command("verify")
    .description(
      "Verify committed reading body hashes, the readings/index.json hash chain, and the git " +
        "pre-registration proof per reading (SPEC §7). Reports 'nothing to check yet' honestly on an empty corpus.",
    )
    .action(() => {
      const result = runVerify(env.cwd, io);
      if (!result.ok) throw new CliExitError(CLI_EXIT.VERIFY_FAILED);
    });

  program
    .command("lint")
    .argument("[suiteId]", "lint only this suite (default: every suite under observatory/suites/)")
    .description(
      "Schema, the negatives quota, item immutability vs git, provenance level present, maxTokens headroom (SPEC §7).",
    )
    .action((suiteId: string | undefined) => {
      const options: LintCommandOptions = { suiteId };
      const code = runLintCommand(io, options, { cwd: env.cwd });
      if (code !== CLI_EXIT.CLEAN) throw new CliExitError(code);
    });

  program
    .command("init")
    .description(
      "Scaffold a suite from real artifacts — exactly one of --from-skills/--from-mcp/--from-snapgauge (SPEC §7/§14 M8). Never spends.",
    )
    .option("--from-skills <dir>", "a directory of <skill-name>/SKILL.md folders (the Claude Code skills convention)")
    .option("--from-mcp <file>", "a JSON file: an array of tools, or { \"tools\": [...] } (an MCP tools/list dump)")
    .option("--from-snapgauge <file>", "a snapgauge snapshot JSON file (its tools[] carries real tool schemas — free interop)")
    .option("--suite-id <id>", "override the generated suite's id (default: from-skills / from-mcp / from-snapgauge)")
    .action((opts: { fromSkills?: string; fromMcp?: string; fromSnapgauge?: string; suiteId?: string }) => {
      const options: InitCommandOptions = {
        fromSkills: opts.fromSkills,
        fromMcp: opts.fromMcp,
        fromSnapgauge: opts.fromSnapgauge,
        suiteId: opts.suiteId,
      };
      const code = runInitCommand(io, options, { cwd: env.cwd, now: deps.now });
      if (code !== CLI_EXIT.CLEAN) throw new CliExitError(code);
    });

  program
    .command("plan")
    .description("Build the run matrix, estimate cost, cap-check it, and write plan.json (SPEC §7).")
    .requiredOption("--run-group <id>", "run group id, e.g. rg-20260815-1")
    .option("--offline", "skip count_tokens; fall back to the manifest heuristic (marks the estimate approximate)", false)
    .option("--mode <mode>", "batch (default, -50%) or sync", "batch")
    .option("--suites <ids>", "comma-separated suite ids to include (default: every suite in observatory/suites/)")
    .option("--date <date>", "YYYY-MM-DD pricing-effective date (default: today)")
    .action(async (opts: { runGroup: string; offline: boolean; mode: string; suites?: string; date?: string }) => {
      if (opts.mode !== "batch" && opts.mode !== "sync") throw new CliExitError(CLI_EXIT.USAGE);
      const options: PlanCommandOptions = {
        offline: opts.offline,
        mode: opts.mode,
        runGroupId: opts.runGroup,
        suiteIds: opts.suites?.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
        date: opts.date,
      };
      const code = await runPlanCommand(io, options, {
        cwd: env.cwd,
        now: deps.now,
        env: env.env,
        buildClient: deps.buildClient,
      });
      if (code !== CLI_EXIT.CLEAN) throw new CliExitError(code);
    });

  program
    .command("run")
    .description("Execute a pinned plan.json — submit/collect trials, re-check caps, write readings (SPEC §7/§9).")
    .requiredOption("--plan <runGroupId>", "run group id whose plan.json to execute")
    .option("--resume", "resume an existing (partial) run rather than starting fresh", false)
    .option("--batch", "force batch mode (must match plan.json)")
    .option("--sync", "force sync mode (must match plan.json)")
    .action(async (opts: { plan: string; resume: boolean; batch?: boolean; sync?: boolean }) => {
      if (opts.batch === true && opts.sync === true) throw new CliExitError(CLI_EXIT.USAGE);
      const options: RunCommandOptions = {
        runGroupId: opts.plan,
        resume: opts.resume,
        mode: opts.batch === true ? "batch" : opts.sync === true ? "sync" : undefined,
      };
      const code = await runRunCommand(io, options, {
        cwd: env.cwd,
        now: deps.now,
        env: env.env,
        buildClient: deps.buildClient,
        harnessCommit: deps.harnessCommit,
      });
      if (code !== CLI_EXIT.CLEAN) throw new CliExitError(code);
    });

  return program;
}

export async function runCli(
  argv: string[],
  io: CliIo,
  env: CliEnv,
  deps: CliDeps = {},
): Promise<number> {
  const resolvedDeps: Required<CliDeps> = {
    now: deps.now ?? defaultNow,
    buildClient: deps.buildClient ?? defaultBuildClient,
    harnessCommit: deps.harnessCommit ?? "unknown",
  };
  const program = buildProgram(io, env, resolvedDeps);
  try {
    await program.parseAsync(argv, { from: "user" });
    return CLI_EXIT.CLEAN;
  } catch (error) {
    if (error instanceof CliExitError) return error.exitCode;
    if (error instanceof Error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "commander.helpDisplayed" || code === "commander.version") {
        return CLI_EXIT.CLEAN;
      }
    }
    return CLI_EXIT.USAGE;
  }
}
