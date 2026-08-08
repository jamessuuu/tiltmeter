/**
 * The `tiltmeter` CLI program (SPEC §7). `runCli` is the testable core:
 * argv in, exit code out, all I/O through the injected `io`/`env` — the
 * only place in the codebase that touches `process.exit` / env / cwd is
 * `src/cli/index.ts` (the bin), which just forwards real argv/streams/env
 * here (mirrors snapgauge's `runCli` shape).
 *
 * M0/M1: the program shell + version/help only. Subcommands land milestone
 * by milestone — SPEC §7's full table is `init`, `lint`, `plan`, `run`,
 * `compare`, `report`, `verify`. `verify` lands at M2 (this file); the rest
 * follow at M4/M5 once the real client and observatory exist.
 */
import { Command } from "commander";
import { TILTMETER_VERSION } from "../core/version.js";
import { runVerify } from "./verify.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliEnv {
  cwd: string;
  env: Record<string, string | undefined>;
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

function buildProgram(io: CliIo, env: CliEnv): Command {
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
      "Verify committed reading body hashes and the readings/index.json hash chain (SPEC §7). " +
        "Reports the git pre-registration walk as not-yet-implemented — it lands at M5, never a false pass.",
    )
    .action(() => {
      const result = runVerify(env.cwd, io);
      if (!result.ok) throw new CliExitError(CLI_EXIT.VERIFY_FAILED);
    });

  return program;
}

/** Exit codes (SPEC §13 typed error taxonomy; usage errors are always 4). */
export const CLI_EXIT = {
  CLEAN: 0,
  VERIFY_FAILED: 1,
  USAGE: 4,
} as const;

export async function runCli(
  argv: string[],
  io: CliIo,
  env: CliEnv,
): Promise<number> {
  const program = buildProgram(io, env);
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
