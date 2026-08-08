/**
 * `src/node/git.ts` against a REAL temp git repo — this is the one file in
 * the codebase whose whole job is shelling out to git, so its tests
 * exercise the real binary rather than mocking it (mirrors `cli/verify.test.ts`'s
 * own "no fake-fs abstraction to inject" precedent). Local `user.name`/
 * `user.email` are set per-repo (`-c`) so this never depends on the
 * machine's global git config (CI has none).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitDateOnly, currentCommit, fileCommitHistory, fileContentAtCommit, findFirstCommitWithHash } from "./git.js";

let dir: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tiltmeter-git-"));
  git(["init", "-q", "-b", "main"]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** `commitDateOnly` reads the COMMITTER date, which a bare `--date` flag does not set (that only sets author date) — both are pinned via env so the resulting commit's date is deterministic and test-controlled. */
function commitFileAt(relPath: string, content: string, message: string, isoDate: string): string {
  writeFileSync(join(dir, relPath), content);
  git(["add", relPath]);
  const env = { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate };
  execFileSync(
    "git",
    ["-c", "user.name=tiltmeter-test", "-c", "user.email=test@example.invalid", "commit", "-m", message],
    { cwd: dir, encoding: "utf8", env },
  );
  return git(["rev-parse", "HEAD"]);
}

describe("fileCommitHistory", () => {
  it("empty for a path with no history", () => {
    expect(fileCommitHistory(dir, "nonexistent.json")).toEqual([]);
  });

  it("empty when cwd is not a git repo at all", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "tiltmeter-not-git-"));
    try {
      expect(fileCommitHistory(notARepo, "anything.json")).toEqual([]);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("returns every commit touching the file, oldest first", () => {
    const c1 = commitFileAt("suite.json", "v1", "add", "2026-01-01T00:00:00Z");
    const c2 = commitFileAt("suite.json", "v2", "edit", "2026-02-01T00:00:00Z");
    expect(fileCommitHistory(dir, "suite.json")).toEqual([c1, c2]);
  });
});

describe("fileContentAtCommit", () => {
  it("returns the exact content at that commit", () => {
    const c1 = commitFileAt("suite.json", "version one", "add", "2026-01-01T00:00:00Z");
    commitFileAt("suite.json", "version two", "edit", "2026-02-01T00:00:00Z");
    expect(fileContentAtCommit(dir, c1, "suite.json")).toBe("version one");
  });

  it("undefined for a path that does not exist at that commit", () => {
    const c1 = commitFileAt("suite.json", "v1", "add", "2026-01-01T00:00:00Z");
    expect(fileContentAtCommit(dir, c1, "does-not-exist.json")).toBeUndefined();
  });
});

describe("currentCommit (M7: the real harnessCommit the bin resolves)", () => {
  it("undefined when cwd is not a git repo at all", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "tiltmeter-not-git-"));
    try {
      expect(currentCommit(notARepo)).toBeUndefined();
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("undefined for a freshly-init'd repo with no commits yet", () => {
    expect(currentCommit(dir)).toBeUndefined();
  });

  it("returns HEAD's SHA once a commit exists", () => {
    const c1 = commitFileAt("suite.json", "v1", "add", "2026-01-01T00:00:00Z");
    expect(currentCommit(dir)).toBe(c1);
  });

  it("tracks HEAD across further commits", () => {
    commitFileAt("suite.json", "v1", "add", "2026-01-01T00:00:00Z");
    const c2 = commitFileAt("suite.json", "v2", "edit", "2026-02-01T00:00:00Z");
    expect(currentCommit(dir)).toBe(c2);
  });
});

describe("commitDateOnly", () => {
  it("returns the committer date truncated to YYYY-MM-DD", () => {
    const c1 = commitFileAt("suite.json", "v1", "add", "2026-03-15T10:30:00Z");
    expect(commitDateOnly(dir, c1)).toBe("2026-03-15");
  });
});

describe("findFirstCommitWithHash (SPEC §7: the git-walk half of the pre-registration proof)", () => {
  const hashFn = (content: string): string => `hash-of(${content})`;

  it("finds the FIRST (oldest) commit whose content reproduces the target hash", () => {
    const c1 = commitFileAt("suite.json", "content-a", "v1", "2026-01-01T00:00:00Z");
    commitFileAt("suite.json", "content-b", "v2", "2026-02-01T00:00:00Z");
    commitFileAt("suite.json", "content-c", "v3", "2026-03-01T00:00:00Z");

    const found = findFirstCommitWithHash(dir, "suite.json", "hash-of(content-a)", hashFn);
    expect(found?.commit).toBe(c1);
    expect(found?.date).toBe("2026-01-01");
  });

  it("finds a hash reached only after a later edit, not just the first commit", () => {
    commitFileAt("suite.json", "content-a", "v1", "2026-01-01T00:00:00Z");
    const c2 = commitFileAt("suite.json", "content-b", "v2", "2026-02-01T00:00:00Z");

    const found = findFirstCommitWithHash(dir, "suite.json", "hash-of(content-b)", hashFn);
    expect(found?.commit).toBe(c2);
  });

  it("undefined when no commit in the file's history ever produced that hash", () => {
    commitFileAt("suite.json", "content-a", "v1", "2026-01-01T00:00:00Z");
    expect(findFirstCommitWithHash(dir, "suite.json", "hash-of(never-existed)", hashFn)).toBeUndefined();
  });

  it("skips a historical revision that throws under the CURRENT hashFn (schema drift) rather than crashing the walk", () => {
    commitFileAt("suite.json", "unparseable-old-shape", "v1", "2026-01-01T00:00:00Z");
    const c2 = commitFileAt("suite.json", "content-b", "v2", "2026-02-01T00:00:00Z");
    const throwingHashFn = (content: string): string => {
      if (content === "unparseable-old-shape") throw new Error("does not parse under the current schema");
      return `hash-of(${content})`;
    };
    const found = findFirstCommitWithHash(dir, "suite.json", "hash-of(content-b)", throwingHashFn);
    expect(found?.commit).toBe(c2);
  });
});
