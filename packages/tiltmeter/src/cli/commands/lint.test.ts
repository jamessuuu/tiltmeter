import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalStringify } from "../../core/canonical.js";
import { suiteSpecHash } from "../../core/suite.js";
import { buildFixtureSuite } from "../../testing/fixtures.js";
import { CLI_EXIT, runCli } from "../run.js";

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
}

let dir: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function writeSuite(id: string, suite: unknown): void {
  mkdirSync(join(dir, "observatory", "suites"), { recursive: true });
  writeFileSync(join(dir, "observatory", "suites", `${id}.suite.json`), canonicalStringify(suite));
}

function commitAll(message: string): void {
  git(["add", "-A"]);
  git(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", message]);
}

/** A minimal, schema-valid `readings/<runGroupId>/<suiteId>__<cellId>.json` fixture — `bodyHash`/hash-content correctness is `tiltmeter verify`'s concern, not lint's; the schema only requires a non-empty string. */
function writeReading(runGroupId: string, suiteId: string, cellId: string, pinnedSuiteSpecHash: string): void {
  mkdirSync(join(dir, "observatory", "readings", runGroupId), { recursive: true });
  const reading = {
    formatVersion: 1,
    runGroupId,
    suiteId,
    cellId,
    axes: {
      suiteSpecHash: pinnedSuiteSpecHash,
      modelIdRequested: "claude-haiku-4-5",
      modelIdResolved: "claude-haiku-4-5",
      aliasUsed: false,
      runnerBehaviorVersion: 1,
      presentationHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      samplingPolicyHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    harnessCommit: "0".repeat(40),
    runnerVersion: "1.0.0-rc.1",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:00:00.000Z",
    status: "complete",
    completeness: { expectedTrials: 0, ok: 0, error: 0, noResult: 0 },
    metrics: {},
    items: [],
    bodyHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
  writeFileSync(join(dir, "observatory", "readings", runGroupId, `${suiteId}__${cellId}.json`), canonicalStringify(reading));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tiltmeter-cli-lint-"));
  git(["init", "-q", "-b", "main"]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("tiltmeter lint", () => {
  it("exits USAGE when no suites exist", async () => {
    const { io, err } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.USAGE);
    expect(err.some((l) => l.includes("no suites found"))).toBe(true);
  });

  it("passes a well-formed, uncommitted (brand-new) suite", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 8, negativeCount: 3, k: 1 });
    writeSuite("demo", { ...suite, sampling: { ...suite.sampling, maxTokens: 512 } });

    const { io, out } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.some((l) => l.startsWith("OK") && l.includes("demo"))).toBe(true);
  });

  it("fails a suite short of the negatives quota", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 20, negativeCount: 1, k: 1 });
    writeSuite("demo", { ...suite, sampling: { ...suite.sampling, maxTokens: 512 } });

    const { io, err } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.LINT_FAILED);
    expect(err.some((l) => l.includes("negatives-quota"))).toBe(true);
  });

  it("fails a suite below the maxTokens headroom floor", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 8, negativeCount: 3, k: 1 });
    writeSuite("demo", { ...suite, sampling: { ...suite.sampling, maxTokens: 64 } });

    const { io, err } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.LINT_FAILED);
    expect(err.some((l) => l.includes("maxTokens-headroom"))).toBe(true);
  });

  it("SPEC §3.1 Decision 2: fails when a previously-committed item was edited in place", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 8, negativeCount: 3, k: 1 });
    const full = { ...suite, sampling: { ...suite.sampling, maxTokens: 512 } };
    writeSuite("demo", full);
    commitAll("add demo suite");

    const [firstItem, ...rest] = full.items;
    if (firstItem === undefined) throw new Error("expected an item");
    const edited = { ...full, items: [{ ...firstItem, scenario: "an edited scenario" }, ...rest] };
    writeSuite("demo", edited);

    const { io, err } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.LINT_FAILED);
    expect(err.some((l) => l.includes("item-edited-in-place"))).toBe(true);
  });

  it("allows retiring a previously-committed item (adds a retired block, does not edit other fields)", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 8, negativeCount: 3, k: 1 });
    const full = { ...suite, sampling: { ...suite.sampling, maxTokens: 512 } };
    writeSuite("demo", full);
    commitAll("add demo suite");

    const [firstItem, ...rest] = full.items;
    if (firstItem === undefined) throw new Error("expected an item");
    const retired = {
      ...full,
      items: [{ ...firstItem, retired: { at: "2026-09-01", reason: "no longer relevant" } }, ...rest],
    };
    writeSuite("demo", retired);

    const { io } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.CLEAN);
  });

  it("can target a single suite id via the positional argument", async () => {
    const a = buildFixtureSuite({ id: "suite-a", positiveCount: 8, negativeCount: 3, k: 1 });
    const b = buildFixtureSuite({ id: "suite-b", positiveCount: 20, negativeCount: 1, k: 1 }); // fails quota
    writeSuite("suite-a", { ...a, sampling: { ...a.sampling, maxTokens: 512 } });
    writeSuite("suite-b", { ...b, sampling: { ...b.sampling, maxTokens: 512 } });

    const { io, out } = makeIo();
    const code = await runCli(["lint", "suite-a"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.some((l) => l.includes("suite-b"))).toBe(false);
  });
});

/**
 * Adversarial-review regression coverage: the realistic threat model is a
 * MERGED PR, i.e. the violating edit is itself committed — not just sitting
 * uncommitted in a working tree (the only case the old `HEAD`-vs-disk
 * comparison could ever catch; see the module doc on `src/cli/commands/lint.ts`).
 * Every scenario below commits the baseline, THEN commits a second change,
 * THEN lints at that clean HEAD.
 */
describe("tiltmeter lint — item immutability vs a COMMITTED edit (SPEC §3.1 Decision 2, the real threat model)", () => {
  it("fails when a previously-published item is edited in place and the edit is committed", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 8, negativeCount: 3, k: 1 });
    const full = { ...suite, sampling: { ...suite.sampling, maxTokens: 512 } };
    writeSuite("demo", full);
    commitAll("add demo suite");

    const [firstItem, ...rest] = full.items;
    if (firstItem === undefined) throw new Error("expected an item");
    const edited = { ...full, items: [{ ...firstItem, scenario: "an edited scenario, and this edit is committed" }, ...rest] };
    writeSuite("demo", edited);
    commitAll("edit item in place (the violation)"); // the crucial difference from the "uncommitted" test above: this IS HEAD, tree is clean

    const { io, err } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.LINT_FAILED);
    expect(err.some((l) => l.includes("item-edited-in-place") && l.includes(firstItem.id))).toBe(true);
  });

  it("still passes when a NEW item is added and the addition is committed (the sanctioned way to grow a suite)", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 8, negativeCount: 3, k: 1 });
    const full = { ...suite, sampling: { ...suite.sampling, maxTokens: 512 } };
    writeSuite("demo", full);
    commitAll("add demo suite");

    const grown = {
      ...full,
      items: [
        ...full.items,
        {
          id: "brand-new-item",
          probe: "activation" as const,
          polarity: "positive" as const,
          registeredAt: "2026-09-01",
          scenario: "a brand new scenario, never published before",
          expect: { scorer: "no-tool-called" as const },
        },
      ],
    };
    writeSuite("demo", grown);
    commitAll("add a new item"); // committed, clean tree at HEAD

    const { io, err } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(err).toEqual([]);
  });

  it("still passes when a previously-published item is RETIRED and the retirement is committed (the sanctioned way to change a suite)", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 8, negativeCount: 3, k: 1 });
    const full = { ...suite, sampling: { ...suite.sampling, maxTokens: 512 } };
    writeSuite("demo", full);
    commitAll("add demo suite");

    const [firstItem, ...rest] = full.items;
    if (firstItem === undefined) throw new Error("expected an item");
    const retired = {
      ...full,
      items: [{ ...firstItem, retired: { at: "2026-09-01", reason: "no longer relevant" } }, ...rest],
    };
    writeSuite("demo", retired);
    commitAll("retire an item"); // committed, clean tree at HEAD

    const { io, err } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(err).toEqual([]);
  });

  it("prefers the last PUBLISHED READING's pinned suite over merely the previous commit — catches an edit that slipped through at an earlier commit, before any reading published it", async () => {
    const suite = buildFixtureSuite({ id: "demo", positiveCount: 8, negativeCount: 3, k: 1 });
    const full = { ...suite, sampling: { ...suite.sampling, maxTokens: 512 } };
    writeSuite("demo", full);
    commitAll("c1: add demo suite (this is what actually got published)");
    const publishedHash = suiteSpecHash(full);
    writeReading("rg-1", "demo", "cell-a", publishedHash);

    // c2: an undetected violation (e.g. lint wasn't run, or ran before this
    // fix existed) — item edited in place, no retirement, no new id.
    const [firstItem, ...rest] = full.items;
    if (firstItem === undefined) throw new Error("expected an item");
    const corruptedAtC2 = { ...full, items: [{ ...firstItem, scenario: "quietly corrupted at c2" }, ...rest] };
    writeSuite("demo", corruptedAtC2);
    commitAll("c2: item edited in place (slipped through undetected)");

    // c3: a LATER, unrelated, legitimate change (retire a different item).
    // Comparing HEAD against merely "the previous commit" (c2) would see NO
    // difference for firstItem, since c2 already carries the corruption —
    // only comparing against the actually-published baseline (c1, via the
    // reading) can still catch it.
    const secondItem = corruptedAtC2.items[1];
    if (secondItem === undefined) throw new Error("expected a second item");
    const c3 = {
      ...corruptedAtC2,
      items: [
        corruptedAtC2.items[0],
        { ...secondItem, retired: { at: "2026-09-02", reason: "unrelated cleanup" } },
        ...corruptedAtC2.items.slice(2),
      ],
    };
    writeSuite("demo", c3);
    commitAll("c3: unrelated legitimate retirement");

    const { io, err } = makeIo();
    const code = await runCli(["lint"], io, { cwd: dir, env: {} });
    expect(code).toBe(CLI_EXIT.LINT_FAILED);
    expect(err.some((l) => l.includes("item-edited-in-place") && l.includes(firstItem.id))).toBe(true);
  });
});
