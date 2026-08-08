import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalStringify } from "../../core/canonical.js";
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
