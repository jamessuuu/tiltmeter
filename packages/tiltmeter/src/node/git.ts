/**
 * Git introspection (SPEC §6: "src/node — fs, git introspection, config
 * loader"; SPEC §7 `verify`'s pre-registration proof: "walks git history
 * for the first commit whose tree contains that hash"). Every function
 * here shells out to the real `git` binary via `execFileSync` — this is
 * the one place in the codebase allowed to do that. `core/verify.ts` owns
 * the DECISION (`evaluatePreRegistration`); this file only resolves the
 * facts a git history actually contains.
 */
import { execFileSync } from "node:child_process";

function git(cwd: string, args: string[]): string {
  // stderr is piped (not inherited) and discarded on failure — every caller
  // in this file already catches and treats a failure as "not found",
  // never crashes, so a bare "fatal: not a git repository" (the common case
  // in tests, whose fixtures are plain temp directories) should not spam
  // real console output.
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Every commit SHA that ever touched `relPath`, OLDEST first (`--reverse`) — `--follow` so a historical rename is still tracked. Empty array if the path has no history (never committed, or `cwd` is not a git repo). */
export function fileCommitHistory(repoRoot: string, relPath: string): string[] {
  let out: string;
  try {
    out = git(repoRoot, ["log", "--follow", "--format=%H", "--reverse", "--", relPath]);
  } catch {
    return [];
  }
  return out.length === 0 ? [] : out.split("\n");
}

/** The file's exact content AT a given commit, or `undefined` if that commit's tree has no such path (e.g. before it was added, or after a since-reverted rename). */
export function fileContentAtCommit(repoRoot: string, commitSha: string, relPath: string): string | undefined {
  try {
    return git(repoRoot, ["show", `${commitSha}:${relPath}`]);
  } catch {
    return undefined;
  }
}

/** A commit's committer date as `YYYY-MM-DD` (SPEC §7's pre-registration date comparison — date precision, not timestamp, is what "registered before a model existed" means in practice). */
export function commitDateOnly(repoRoot: string, commitSha: string): string {
  return git(repoRoot, ["show", "-s", "--format=%cI", commitSha]).slice(0, 10);
}

/**
 * The git-walk half of SPEC §7's pre-registration proof: given a suite
 * file's path and the EXACT `suiteSpecHash` a reading pinned, find the
 * first (oldest) commit whose version of that file recomputes to that
 * same hash — `hashFn` is injected (`core/suite.ts`'s `suiteSpecHash`
 * composed with `parseSuite`) so this module never imports `core/` and
 * stays a pure git-mechanics layer. Returns `undefined` if no commit in
 * the file's history ever produced that hash (the file may have moved
 * past it, or the hash may not belong to this file's history at all).
 */
export function findFirstCommitWithHash(
  repoRoot: string,
  relPath: string,
  targetHash: string,
  hashFn: (fileContent: string) => string | undefined,
): { commit: string; date: string } | undefined {
  for (const commit of fileCommitHistory(repoRoot, relPath)) {
    const content = fileContentAtCommit(repoRoot, commit, relPath);
    if (content === undefined) continue;
    let computed: string | undefined;
    try {
      computed = hashFn(content);
    } catch {
      continue; // a historical revision that doesn't parse under the CURRENT schema — skip, don't crash the walk
    }
    if (computed === targetHash) {
      return { commit, date: commitDateOnly(repoRoot, commit) };
    }
  }
  return undefined;
}
