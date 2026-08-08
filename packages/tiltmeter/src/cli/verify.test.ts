/**
 * `cli/verify.ts` is the one core-adjacent file allowed to touch real
 * `node:fs` (SPEC §6: node builtins live in `src/cli/**`), so its tests use
 * a real temp directory rather than an injected fake filesystem — there is
 * no `src/node` abstraction to inject yet (M4/M5).
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalStringify } from "../core/canonical.js";
import { appendEntry } from "../core/index-chain.js";
import { presentationHash, samplingPolicyHash } from "../core/presentation.js";
import { suiteSpecHash } from "../core/suite.js";
import { RUNNER_BEHAVIOR_VERSION } from "../core/version.js";
import { runSuite, type RunContext } from "../core/run.js";
import { buildFixtureSuite, FakeModelClient, FIXTURE_PRESENTATION, allPassBehavior, scriptForBehavior } from "../testing/index.js";
import { readReadingsCorpus, runVerify } from "./verify.js";

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tiltmeter-verify-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function writeValidReading(runGroupId: string, cellId: string): Promise<{ bodyHash: string; suiteId: string }> {
  const suite = buildFixtureSuite({ id: "cli-verify-suite", positiveCount: 2, negativeCount: 1, k: 1 });
  const ctx: RunContext = {
    runGroupId,
    cellId,
    suiteSpecHash: suiteSpecHash(suite),
    presentationHash: presentationHash(FIXTURE_PRESENTATION),
    samplingPolicyHash: samplingPolicyHash(suite.sampling),
    runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
    modelIdRequested: "fake-model-1",
    harnessCommit: "0000000000000000000000000000000000000",
    runnerVersion: "0.1.0-alpha.0",
    now: () => "2026-08-08T00:00:00.000Z",
  };
  const client = new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) });
  const reading = await runSuite(suite, FIXTURE_PRESENTATION, client, ctx);

  const runGroupDir = join(dir, "observatory", "readings", runGroupId);
  mkdirSync(runGroupDir, { recursive: true });
  writeFileSync(join(runGroupDir, `${reading.suiteId}__${cellId}.json`), canonicalStringify(reading));
  return { bodyHash: reading.bodyHash, suiteId: reading.suiteId };
}

describe("readReadingsCorpus", () => {
  it("returns empty when observatory/readings does not exist", () => {
    const result = readReadingsCorpus(join(dir, "observatory"));
    expect(result.readings).toEqual([]);
    expect(result.indexChain).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("reads a valid reading file and skips run.json", async () => {
    await writeValidReading("rg-1", "cell-a");
    const runGroupDir = join(dir, "observatory", "readings", "rg-1");
    writeFileSync(join(runGroupDir, "run.json"), "{}"); // not a Reading — must be skipped, not parsed as one

    const result = readReadingsCorpus(join(dir, "observatory"));
    expect(result.readings).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("records a parse error for a malformed reading file instead of throwing", () => {
    const runGroupDir = join(dir, "observatory", "readings", "rg-1");
    mkdirSync(runGroupDir, { recursive: true });
    writeFileSync(join(runGroupDir, "suite-a__cell-a.json"), JSON.stringify({ not: "a reading" }));

    const result = readReadingsCorpus(join(dir, "observatory"));
    expect(result.readings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("suite-a__cell-a.json");
  });

  it("parses a valid readings/index.json", async () => {
    const { bodyHash, suiteId } = await writeValidReading("rg-1", "cell-a");
    const entry = appendEntry([], {
      runGroupId: "rg-1",
      at: "2026-08-08T00:00:00.000Z",
      harnessCommit: "0000000000000000000000000000000000000",
      runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
      cells: [{ suiteId, cellId: "cell-a", bodyHash }],
      status: "complete",
      costUsd: 0.01,
    });
    writeFileSync(join(dir, "observatory", "readings", "index.json"), canonicalStringify([entry]));

    const result = readReadingsCorpus(join(dir, "observatory"));
    expect(result.indexChain).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
});

describe("runVerify", () => {
  it("reports ok on an empty corpus (nothing committed yet — M5 territory)", () => {
    const { io, out } = makeIo();
    const result = runVerify(dir, io);
    expect(result.ok).toBe(true);
    expect(result.emptyCorpus).toBe(true);
    expect(out.some((line) => line.includes("nothing to verify"))).toBe(true);
  });

  it("always prints the git pre-registration walk as not-yet-implemented, even on an empty corpus", () => {
    const { io, out } = makeIo();
    runVerify(dir, io);
    expect(out.some((line) => line.includes("NOT IMPLEMENTED"))).toBe(true);
  });

  it("ok when every reading's body hash and the index chain both verify", async () => {
    const { bodyHash, suiteId } = await writeValidReading("rg-1", "cell-a");
    const entry = appendEntry([], {
      runGroupId: "rg-1",
      at: "2026-08-08T00:00:00.000Z",
      harnessCommit: "0000000000000000000000000000000000000",
      runnerBehaviorVersion: RUNNER_BEHAVIOR_VERSION,
      cells: [{ suiteId, cellId: "cell-a", bodyHash }],
      status: "complete",
      costUsd: 0.01,
    });
    writeFileSync(join(dir, "observatory", "readings", "index.json"), canonicalStringify([entry]));

    const { io, out } = makeIo();
    const result = runVerify(dir, io);
    expect(result.ok).toBe(true);
    expect(out.some((line) => line.includes("OK") && line.includes("body hash"))).toBe(true);
  });

  it("not ok when a reading's committed bytes were tampered with after the fact", async () => {
    await writeValidReading("rg-1", "cell-a");
    const runGroupDir = join(dir, "observatory", "readings", "rg-1");
    const filePath = join(runGroupDir, "cli-verify-suite__cell-a.json");
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    raw.metrics = { overall: 0.01 }; // tamper without recomputing bodyHash
    writeFileSync(filePath, canonicalStringify(raw));

    const { io } = makeIo();
    const result = runVerify(dir, io);
    expect(result.ok).toBe(false);
    expect(result.corpus.readings.some((r) => !r.ok)).toBe(true);
  });

  it("not ok (and does not throw) when a reading file fails to parse", () => {
    const runGroupDir = join(dir, "observatory", "readings", "rg-1");
    mkdirSync(runGroupDir, { recursive: true });
    writeFileSync(join(runGroupDir, "suite-a__cell-a.json"), "{ not valid json");

    const { io, err } = makeIo();
    const result = runVerify(dir, io);
    expect(result.ok).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(err.length).toBeGreaterThan(0);
  });
});
