#!/usr/bin/env node
/**
 * The `tiltmeter` bin — the only place in the codebase that touches
 * `process.exit` / process streams / real env (SPEC §6: "src/cli is the
 * only place with process.exit / env / cwd").
 */
import { runCli } from "./run.js";
import { currentCommit } from "../node/git.js";

// M7: a real reading's `harnessCommit` must name an actual commit, not the
// "unknown" placeholder `runCli`'s own default falls back to for tests that
// never inject one. `currentCommit` returns `undefined` outside a git repo
// (or before the first commit) — `runCli`'s default takes over in that case.
const cwd = process.cwd();
const resolvedCommit = currentCommit(cwd);

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
  { cwd, env: process.env },
  resolvedCommit === undefined ? {} : { harnessCommit: resolvedCommit },
);
process.exit(code);
