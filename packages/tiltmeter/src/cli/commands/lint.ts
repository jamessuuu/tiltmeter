/**
 * `tiltmeter lint` (SPEC §7): schema (already Zod-enforced by
 * `readAllSuites`/`readSuite` — a suite that fails to parse is reported as
 * its own failure below, never silently skipped), the negatives quota,
 * item immutability vs git, provenance level present, maxTokens headroom
 * (`core/lint.ts`'s `lintSuite`). This file is CLI wiring: resolve each
 * suite's historical baseline and call into core.
 *
 * Baseline resolution (SPEC §3.1 Decision 2: "compares each item's
 * canonical bytes against the last published reading's suite"), in
 * preference order:
 *
 *  1. The suite as it existed in the commit that produced the
 *     `suiteSpecHash` pinned by the most recently *published reading* that
 *     references this suite (`src/cli/verify.ts`'s reading-corpus reader +
 *     `src/node/git.ts`'s `findFirstCommitWithHash` — the exact same walk
 *     `tiltmeter verify`'s pre-registration proof already does). This is
 *     the SPEC-preferred source of truth: it is tied to an actually
 *     executed, published reading, not merely "whatever happened to be
 *     committed before this."
 *  2. If no reading references this suite yet (true today —
 *     `observatory/readings/` starts empty, SPEC §14 M5's honest default):
 *     the previous commit that touched the suite file, resolved via git log
 *     on that path — NOT `HEAD`. Comparing against `HEAD` is the bug this
 *     module fixes: once an edit is committed, `HEAD` and the working tree
 *     are identical, so a HEAD-vs-HEAD comparison is a no-op self-compare
 *     that can never catch a committed edit — only an edit still sitting
 *     uncommitted. The fix is to walk back past whatever commit most
 *     recently touched the file (which might BE the violation) to the one
 *     before it.
 *
 * A suite with no prior commit at all is a genuine first publish — nothing
 * could have been edited yet, so `historicalItems: undefined` with no
 * unresolved-reason is a legitimate, explicitly-noted pass. Anything else
 * that prevents resolving a baseline that SHOULD exist (a historical
 * revision that fails to parse under the current schema, a reading whose
 * pinned hash no longer resolves to any commit, …) is surfaced as
 * `core/lint.ts`'s `immutability-baseline-unresolved` failing issue —
 * never silently treated as "nothing to compare."
 */
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { jcsCanonical } from "../../core/canonical.js";
import { lintSuite, type LintResult } from "../../core/lint.js";
import { parseSuite, suiteSpecHash, type Suite } from "../../core/suite.js";
import { fileCommitHistory, fileContentAtCommit, findFirstCommitWithHash } from "../../node/git.js";
import { readReadingsCorpus } from "../verify.js";
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

interface BaselineResolution {
  /** Feeds `lintSuite`'s 2nd param. `undefined` only for a genuine first publish (no prior commit exists at all — legitimately nothing to compare). */
  items: Suite["items"] | undefined;
  /** Feeds `lintSuite`'s 3rd param. Set whenever a baseline SHOULD exist (there is prior history) but could not be established — `lintSuite` turns this into a failing issue, never a silent pass. */
  unresolvedReason: string | undefined;
  /** Informational only — printed on a pass so the fallback path is never silent about which baseline it actually used. */
  note: string | undefined;
}

const RESOLVED = (items: Suite["items"], note: string | undefined): BaselineResolution => ({ items, unresolvedReason: undefined, note });
const NOTHING_TO_COMPARE = (note?: string): BaselineResolution => ({ items: undefined, unresolvedReason: undefined, note });
const UNRESOLVED = (unresolvedReason: string): BaselineResolution => ({ items: undefined, unresolvedReason, note: undefined });

function tryParseSuite(content: string): Suite | undefined {
  try {
    return parseSuite(JSON.parse(content));
  } catch {
    return undefined;
  }
}

/**
 * Preference 1: the suite as it existed in the commit that produced the
 * `suiteSpecHash` pinned by the most recently published reading that
 * references this suite. `undefined` (not a `BaselineResolution`) means "no
 * reading references this suite yet" — the caller falls through to
 * preference 2, NOT a resolved-or-unresolved outcome in itself.
 */
function resolveFromLastPublishedReading(
  cwd: string,
  observatoryDir: string,
  suiteId: string,
  relPath: string,
): BaselineResolution | undefined {
  const { readings } = readReadingsCorpus(observatoryDir);
  const forThisSuite = readings.filter((r) => r.suiteId === suiteId);
  if (forThisSuite.length === 0) return undefined;

  const latest = forThisSuite.reduce((a, b) => (a.finishedAt >= b.finishedAt ? a : b));
  const label = `${latest.runGroupId}/${latest.cellId}`;
  const found = findFirstCommitWithHash(cwd, relPath, latest.axes.suiteSpecHash, (content) => {
    const parsed = tryParseSuite(content);
    return parsed === undefined ? undefined : suiteSpecHash(parsed);
  });
  if (found === undefined) {
    return UNRESOLVED(
      `no commit in git history reproduces the suiteSpecHash pinned by the most recently published reading (${label})`,
    );
  }
  const content = fileContentAtCommit(cwd, found.commit, relPath);
  if (content === undefined) {
    return UNRESOLVED(`commit ${found.commit} (the last published reading ${label}'s baseline) no longer contains ${relPath}`);
  }
  const parsed = tryParseSuite(content);
  if (parsed === undefined) {
    return UNRESOLVED(`the last published reading ${label}'s suite (commit ${found.commit}) does not parse under the current schema`);
  }
  return RESOLVED(parsed.items, `comparing against the last published reading ${label}'s suite (commit ${found.commit.slice(0, 12)})`);
}

/**
 * Preference 2 (no reading references this suite yet — SPEC §14 M5's
 * honest default, `observatory/readings/` starts empty): the previous
 * commit that touched the suite file, resolved via git log on that path.
 *
 * Deliberately NOT `HEAD`: once an edit lands in a commit, `HEAD` and the
 * on-disk suite are identical, so comparing the current suite to `HEAD`
 * would be a no-op self-comparison — exactly the bug this function exists
 * to close. Instead: if the working tree differs from `HEAD` (an edit still
 * sitting uncommitted), `HEAD` itself is the last published baseline. If
 * the working tree matches `HEAD` (the most recent change was already
 * committed), walk back one commit further, since `HEAD`'s version of this
 * file might BE the violation.
 */
function resolveFromPreviousCommit(cwd: string, relPath: string, currentSuite: Suite): BaselineResolution {
  const history = fileCommitHistory(cwd, relPath); // oldest -> newest
  if (history.length === 0) {
    // Not a git repo (yet), or this file has never been committed at all —
    // genuinely nothing to compare. Not a loophole: there is no prior
    // published state an edit could have hidden behind.
    return NOTHING_TO_COMPARE();
  }

  const headContent = fileContentAtCommit(cwd, "HEAD", relPath);
  if (headContent === undefined) {
    // History exists for this path but HEAD doesn't have it (e.g. a
    // tracked-then-renamed-away-and-back edge case) — not the common case
    // this module targets; nothing safely resolvable either way.
    return NOTHING_TO_COMPARE();
  }
  const headSuite = tryParseSuite(headContent);
  if (headSuite === undefined) {
    return UNRESOLVED(`the commit at HEAD's version of ${relPath} does not parse under the current schema`);
  }

  // Canonical-JSON comparison (not raw bytes) so formatting/line-ending
  // differences between a working-tree file and a git blob are never
  // mistaken for a real edit.
  if (jcsCanonical(currentSuite) !== jcsCanonical(headSuite)) {
    // The working tree still holds an uncommitted change against HEAD —
    // HEAD itself is the last published baseline.
    return RESOLVED(headSuite.items, undefined);
  }

  // Clean tree: HEAD's content for this file IS the most recently touched
  // commit. Walk one further back.
  if (history.length < 2) {
    // The only commit that ever touched this file IS HEAD — first publish.
    return NOTHING_TO_COMPARE("first commit for this suite file — nothing to compare yet");
  }
  const previousCommit = history[history.length - 2];
  if (previousCommit === undefined) throw new Error("unreachable: history.length >= 2");
  const previousContent = fileContentAtCommit(cwd, previousCommit, relPath);
  if (previousContent === undefined) {
    return UNRESOLVED(`could not read ${relPath} at commit ${previousCommit} (the commit before the current tip)`);
  }
  const previousSuite = tryParseSuite(previousContent);
  if (previousSuite === undefined) {
    return UNRESOLVED(`commit ${previousCommit} (the previous commit touching ${relPath}) does not parse under the current schema`);
  }
  return RESOLVED(previousSuite.items, "no published reading yet; comparing against the previous commit touching this file");
}

function resolveHistoricalBaseline(
  cwd: string,
  observatoryDir: string,
  suiteId: string,
  relPath: string,
  currentSuite: Suite,
): BaselineResolution {
  const fromReading = resolveFromLastPublishedReading(cwd, observatoryDir, suiteId, relPath);
  return fromReading ?? resolveFromPreviousCommit(cwd, relPath, currentSuite);
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
    const baseline = resolveHistoricalBaseline(deps.cwd, observatoryDir, read.id, read.relPath, read.suite);
    const result: LintResult = lintSuite(read.suite, baseline.items, baseline.unresolvedReason);
    if (result.ok) {
      const suffix = baseline.note === undefined ? "" : ` (${baseline.note})`;
      io.stdout(`OK   ${read.id} — schema, negatives quota, provenance, maxTokens headroom, item immutability${suffix}`);
    } else {
      anyFailed = true;
      for (const issue of result.issues) io.stderr(`FAIL ${read.id} — [${issue.code}] ${issue.message}`);
    }
  }

  return anyFailed ? CLI_EXIT.LINT_FAILED : CLI_EXIT.CLEAN;
}
