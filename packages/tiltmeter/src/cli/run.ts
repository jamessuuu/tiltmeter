/**
 * The `tiltmeter` CLI program (SPEC §7). `runCli` is the testable core:
 * argv in, exit code out, all I/O through the injected `io`/`env` — the
 * only place in the codebase that touches `process.exit` / env / cwd is
 * `src/cli/index.ts` (the bin), which just forwards real argv/streams/env
 * here (mirrors snapgauge's `runCli` shape).
 *
 * M0: the program shell only (`--version`, `--help`). Subcommands land
 * milestone by milestone — SPEC §7's full table is `init`, `lint`, `plan`,
 * `run`, `compare`, `report`, `verify`; `compare` and `verify` land at
 * M1/M2 per docs/SPEC.md §14.
 */
import { Command } from "commander";
import { TILTMETER_VERSION } from "../core/version.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliEnv {
  cwd: string;
  env: Record<string, string | undefined>;
}

function buildProgram(io: CliIo): Command {
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
  return program;
}

/** Exit codes (SPEC §13 typed error taxonomy; usage errors are always 4). */
export const CLI_EXIT = {
  CLEAN: 0,
  USAGE: 4,
} as const;

export async function runCli(
  argv: string[],
  io: CliIo,
  _env: CliEnv,
): Promise<number> {
  const program = buildProgram(io);
  try {
    await program.parseAsync(argv, { from: "user" });
    return CLI_EXIT.CLEAN;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "commander.helpDisplayed" || code === "commander.version") {
        return CLI_EXIT.CLEAN;
      }
    }
    return CLI_EXIT.USAGE;
  }
}
