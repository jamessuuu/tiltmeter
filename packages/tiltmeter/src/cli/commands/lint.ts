/**
 * `tiltmeter lint` (SPEC §7): schema (already Zod-enforced by
 * `readAllSuites`/`readSuite` — a suite that fails to parse is reported as
 * its own failure below, never silently skipped), the negatives quota,
 * item immutability vs git, provenance level present, maxTokens headroom
 * (`core/lint.ts`'s `lintSuite`). This file is CLI wiring: resolve each
 * suite's previously-committed version via `src/node/git.ts`, call into
 * core, print results.
 */
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { lintSuite, type LintResult } from "../../core/lint.js";
import { parseSuite, type Suite } from "../../core/suite.js";
import { fileContentAtCommit } from "../../node/git.js";
import type { CliIo } from "../run.js";
import { CLI_EXIT } from "../exit-codes.js";

export interface LintCommandOptions {
  /** Lint only this suite id; omit to lint every suite under `observatory/suites/`. */
  suiteId: string | undefined;
}

export interface LintCommandDeps {
  cwd: string;
}

interface SuiteReadResult {
  id: string;
  suite: Suite | undefined;
  parseError: string | undefined;
  relPath: string;
}

function readSuites(observatoryDir: string, onlyId: string | undefined): SuiteReadResult[] {
  const dir = join(observatoryDir, "suites");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".suite.json"));
  const out: SuiteReadResult[] = [];
  for (const file of files) {
    const id = file.replace(/\.suite\.json$/, "");
    if (onlyId !== undefined && id !== onlyId) continue;
    const relPath = `observatory/suites/${file}`;
    try {
      const suite = parseSuite(JSON.parse(readFileSync(join(dir, file), "utf8")));
      out.push({ id, suite, parseError: undefined, relPath });
    } catch (error) {
      out.push({ id, suite: undefined, parseError: error instanceof Error ? error.message : String(error), relPath });
    }
  }
  return out;
}

/** The suite file's content at `HEAD`, if any — `undefined` on a brand-new suite with no prior commit, or if `cwd` is not (yet) a git repo. Never throws. */
function historicalItemsAtHead(cwd: string, relPath: string): Suite["items"] | undefined {
  const content = fileContentAtCommit(cwd, "HEAD", relPath);
  if (content === undefined) return undefined;
  try {
    return parseSuite(JSON.parse(content)).items;
  } catch {
    return undefined; // a HEAD revision that predates the current schema — nothing safely comparable
  }
}

export function runLintCommand(io: CliIo, options: LintCommandOptions, deps: LintCommandDeps): number {
  const observatoryDir = join(deps.cwd, "observatory");
  const reads = readSuites(observatoryDir, options.suiteId);

  if (reads.length === 0) {
    io.stderr(
      options.suiteId === undefined
        ? "tiltmeter lint: no suites found under observatory/suites/"
        : `tiltmeter lint: no suite "${options.suiteId}" found under observatory/suites/`,
    );
    return CLI_EXIT.USAGE;
  }

  let anyFailed = false;
  for (const read of reads) {
    if (read.suite === undefined) {
      io.stderr(`FAIL ${read.id} — schema: ${read.parseError ?? "unknown parse error"}`);
      anyFailed = true;
      continue;
    }
    const historicalItems = historicalItemsAtHead(deps.cwd, read.relPath);
    const result: LintResult = lintSuite(read.suite, historicalItems);
    if (result.ok) {
      io.stdout(`OK   ${read.id} — schema, negatives quota, provenance, maxTokens headroom, item immutability`);
    } else {
      anyFailed = true;
      for (const issue of result.issues) io.stderr(`FAIL ${read.id} — [${issue.code}] ${issue.message}`);
    }
  }

  return anyFailed ? CLI_EXIT.LINT_FAILED : CLI_EXIT.CLEAN;
}
