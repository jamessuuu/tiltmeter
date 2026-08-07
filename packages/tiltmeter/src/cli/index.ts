#!/usr/bin/env node
/**
 * The `tiltmeter` bin — the only place in the codebase that touches
 * `process.exit` / process streams / real env (SPEC §6: "src/cli is the
 * only place with process.exit / env / cwd").
 */
import { runCli } from "./run.js";

const code = await runCli(
  process.argv.slice(2),
  {
    stdout: (text) => {
      process.stdout.write(`${text}\n`);
    },
    stderr: (text) => {
      process.stderr.write(`${text}\n`);
    },
  },
  { cwd: process.cwd(), env: process.env },
);
process.exit(code);
