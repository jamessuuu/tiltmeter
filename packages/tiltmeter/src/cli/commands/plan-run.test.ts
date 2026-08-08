/**
 * End-to-end CLI tests for `tiltmeter plan` and `tiltmeter run` against a
 * scaffolded temp `observatory/` (mirrors `cli/verify.test.ts`'s pattern —
 * a real temp directory, since there is no `src/node` fake-filesystem
 * abstraction to inject). Every `run` here injects a `FakeModelClient` via
 * `runCli`'s `deps.buildClient` — SPEC §9/§12: "NO live smoke run", "NO
 * network in tests".
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalStringify } from "../../core/canonical.js";
import { FakeModelClient, allPassBehavior, scriptForBehavior } from "../../testing/index.js";
import { buildFixtureSuite, FIXTURE_PRESENTATION } from "../../testing/fixtures.js";
import type { ModelClient } from "../../core/model-client.js";
import { CLI_EXIT, runCli } from "../run.js";

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
}

const NOW = () => "2026-08-08T03:00:00.000Z";

const PRICING_MANIFEST = {
  formatVersion: 1,
  id: "pricing.test",
  fetchedAt: "2026-08-08",
  source: "test fixture",
  assumedOutputTokensPerTrial: 100,
  models: [
    {
      modelId: "claude-haiku-4-5",
      rows: [
        {
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          standard: { inputPerMTok: 1, outputPerMTok: 5 },
          batch: { inputPerMTok: 0.5, outputPerMTok: 2.5 },
          estimateMultiplier: 1.0,
        },
      ],
    },
  ],
};

let dir: string;

function scaffoldObservatory(): void {
  mkdirSync(join(dir, "observatory", "suites"), { recursive: true });
  mkdirSync(join(dir, "observatory", "presentations"), { recursive: true });
  mkdirSync(join(dir, "observatory", "pricing"), { recursive: true });

  const suite = buildFixtureSuite({ id: "demo-suite", positiveCount: 2, negativeCount: 2, k: 1 });
  writeFileSync(join(dir, "observatory", "suites", "demo-suite.suite.json"), canonicalStringify(suite));
  writeFileSync(join(dir, "observatory", "presentations", "skill-tool@1.json"), canonicalStringify(FIXTURE_PRESENTATION));
  writeFileSync(
    join(dir, "observatory", "panel.json"),
    canonicalStringify({
      formatVersion: 1,
      id: "standing",
      entries: [
        { cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" },
        { cellId: "haiku45-null", modelIdRequested: "claude-haiku-4-5", role: "null" },
      ],
    }),
  );
  writeFileSync(join(dir, "observatory", "pricing", "pricing.test.json"), canonicalStringify(PRICING_MANIFEST));
}

function fakeClientAllPass(): ModelClient {
  const suite = buildFixtureSuite({ id: "demo-suite", positiveCount: 2, negativeCount: 2, k: 1 });
  return new FakeModelClient({ script: scriptForBehavior(suite, allPassBehavior()) });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tiltmeter-cli-plan-run-"));
  scaffoldObservatory();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("tiltmeter plan", () => {
  it("--offline writes plan.json with two cells (SPEC §4 null pair) and marks it approximate", async () => {
    const { io, out } = makeIo();
    const code = await runCli(["plan", "--run-group", "rg-1", "--offline"], io, { cwd: dir, env: {} }, { now: NOW });
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.some((l) => l.includes("2 cell(s)"))).toBe(true);

    const written = JSON.parse(readFileSync(join(dir, "observatory", "readings", "rg-1", "plan.json"), "utf8")) as {
      approximate: boolean;
      cells: unknown[];
    };
    expect(written.approximate).toBe(true);
    expect(written.cells).toHaveLength(2);
  });

  it("refuses without --offline when ANTHROPIC_API_KEY is missing", async () => {
    const { io, err } = makeIo();
    const code = await runCli(["plan", "--run-group", "rg-1"], io, { cwd: dir, env: {} }, { now: NOW });
    expect(code).toBe(CLI_EXIT.USAGE);
    expect(err.some((l) => l.includes("ANTHROPIC_API_KEY"))).toBe(true);
  });

  it("refuses when observatory/panel.json has no valid null pair", async () => {
    writeFileSync(
      join(dir, "observatory", "panel.json"),
      canonicalStringify({ formatVersion: 1, id: "standing", entries: [{ cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" }] }),
    );
    const { io, err } = makeIo();
    const code = await runCli(["plan", "--run-group", "rg-1", "--offline"], io, { cwd: dir, env: {} }, { now: NOW });
    expect(code).toBe(CLI_EXIT.USAGE);
    expect(err.some((l) => l.includes("null pair"))).toBe(true);
  });
});

describe("tiltmeter run", () => {
  it("SPEC §9: missing API key exits before spending, writes a skipped index entry, exits clean", async () => {
    const { io: planIo } = makeIo();
    await runCli(["plan", "--run-group", "rg-1", "--offline"], planIo, { cwd: dir, env: {} }, { now: NOW });

    const { io, err } = makeIo();
    const code = await runCli(["run", "--plan", "rg-1"], io, { cwd: dir, env: {} }, { now: NOW });
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(err.some((l) => l.includes("ANTHROPIC_API_KEY"))).toBe(true);

    const index = JSON.parse(readFileSync(join(dir, "observatory", "readings", "index.json"), "utf8")) as { status: string; reason?: string }[];
    expect(index).toHaveLength(1);
    expect(index[0]?.status).toBe("skipped");
    expect(index[0]?.reason).toContain("ANTHROPIC_API_KEY");
    // Never a silent gap: no reading files were written for the skipped run.
  });

  it("executes a fresh sync run end-to-end and writes readings + run.json + a complete index entry", async () => {
    const { io: planIo } = makeIo();
    await runCli(["plan", "--run-group", "rg-1", "--offline", "--mode", "sync"], planIo, { cwd: dir, env: {} }, { now: NOW });

    const { io, out } = makeIo();
    const code = await runCli(
      ["run", "--plan", "rg-1"],
      io,
      { cwd: dir, env: { ANTHROPIC_API_KEY: "sk-fake" } },
      { now: NOW, buildClient: () => fakeClientAllPass() },
    );
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.some((l) => l.includes("complete"))).toBe(true);

    const readingA = JSON.parse(readFileSync(join(dir, "observatory", "readings", "rg-1", "demo-suite__haiku45.json"), "utf8")) as {
      status: string;
      cost?: { actualUsd: number };
    };
    expect(readingA.status).toBe("complete");
    expect(readingA.cost?.actualUsd).toBeGreaterThanOrEqual(0);

    const index = JSON.parse(readFileSync(join(dir, "observatory", "readings", "index.json"), "utf8")) as { status: string }[];
    expect(index).toHaveLength(1);
    expect(index[0]?.status).toBe("complete");
  });

  it("refuses to start fresh over an existing run — must use --resume", async () => {
    const { io: planIo } = makeIo();
    await runCli(["plan", "--run-group", "rg-1", "--offline", "--mode", "sync"], planIo, { cwd: dir, env: {} }, { now: NOW });
    const deps = { now: NOW, buildClient: () => fakeClientAllPass() };
    const runEnv = { cwd: dir, env: { ANTHROPIC_API_KEY: "sk-fake" } };
    const { io: firstIo } = makeIo();
    await runCli(["run", "--plan", "rg-1"], firstIo, runEnv, deps);

    const { io, err } = makeIo();
    const code = await runCli(["run", "--plan", "rg-1"], io, runEnv, deps);
    expect(code).toBe(CLI_EXIT.USAGE);
    expect(err.some((l) => l.includes("--resume"))).toBe(true);
  });

  it("SPEC §9 duplicate-spend guard: --resume on an already-complete batch run never resubmits", async () => {
    const { io: planIo } = makeIo();
    await runCli(["plan", "--run-group", "rg-1", "--offline"], planIo, { cwd: dir, env: {} }, { now: NOW }); // default mode: batch

    const client = fakeClientAllPass() as FakeModelClient;
    let submitCount = 0;
    const originalSubmit = client.submitBatch.bind(client);
    client.submitBatch = (...args) => {
      submitCount++;
      return originalSubmit(...args);
    };
    const deps = { now: NOW, buildClient: () => client };
    const runEnv = { cwd: dir, env: { ANTHROPIC_API_KEY: "sk-fake" } };

    const { io: firstIo, out: firstOut } = makeIo();
    const firstCode = await runCli(["run", "--plan", "rg-1"], firstIo, runEnv, deps);
    expect(firstCode).toBe(CLI_EXIT.CLEAN);
    expect(firstOut.some((l) => l.includes("complete"))).toBe(true);
    const callsAfterFirst = submitCount;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const { io: resumeIo, out: resumeOut } = makeIo();
    const resumeCode = await runCli(["run", "--plan", "rg-1", "--resume"], resumeIo, runEnv, deps);
    expect(resumeCode).toBe(CLI_EXIT.CLEAN);
    expect(submitCount).toBe(callsAfterFirst); // zero new submissions
    expect(resumeOut.some((l) => l.includes("nothing to do"))).toBe(true);
  });

  it("SPEC §9 / SECURITY.md crash-safety: --resume refuses (never resubmits) a cell an interrupted prior run left \"pending\" with no batchId", async () => {
    const { io: planIo } = makeIo();
    await runCli(["plan", "--run-group", "rg-1", "--offline"], planIo, { cwd: dir, env: {} }, { now: NOW }); // default mode: batch

    // Simulate a process that persisted `preparePendingCell`'s record
    // (customIds recorded — SPEC §9's "written before submission") and was
    // then killed before ever learning whether `client.submitBatch`
    // actually reached the provider.
    mkdirSync(join(dir, "observatory", "readings", "rg-1"), { recursive: true });
    writeFileSync(
      join(dir, "observatory", "readings", "rg-1", "run.json"),
      canonicalStringify({
        formatVersion: 1,
        runGroupId: "rg-1",
        planSuiteSpecHashes: {},
        startedAt: NOW(),
        cells: [
          {
            suiteId: "demo-suite",
            cellId: "haiku45",
            modelIdRequested: "claude-haiku-4-5",
            mode: "batch",
            customIds: { "pos-1": ["deadbeef00000000000000000000000000000000000000000000000000000000"] },
            status: "pending",
          },
        ],
        costUsdSoFar: 0,
      }),
    );

    const client = fakeClientAllPass() as FakeModelClient;
    let submitCount = 0;
    const originalSubmit = client.submitBatch.bind(client);
    client.submitBatch = (...args) => {
      submitCount++;
      return originalSubmit(...args);
    };

    const { io, err } = makeIo();
    const code = await runCli(
      ["run", "--plan", "rg-1", "--resume"],
      io,
      { cwd: dir, env: { ANTHROPIC_API_KEY: "sk-fake" } },
      { now: NOW, buildClient: () => client },
    );

    expect(code).toBe(CLI_EXIT.RESUME_AMBIGUOUS);
    expect(submitCount).toBe(0); // never resubmitted — the whole point
    expect(err.some((l) => l.includes("pending") && l.includes("deadbeef"))).toBe(true);

    // Nothing new was written — run.json still holds exactly the pending
    // record the interrupted run left, not a fabricated resubmission.
    const persisted = JSON.parse(readFileSync(join(dir, "observatory", "readings", "rg-1", "run.json"), "utf8")) as {
      cells: { status: string; batchId?: string }[];
    };
    expect(persisted.cells).toHaveLength(1);
    expect(persisted.cells[0]?.status).toBe("pending");
    expect(persisted.cells[0]?.batchId).toBeUndefined();
  });

  it("SPEC §9: a suite edited between plan and run refuses with E_PLAN_STALE (re-plan)", async () => {
    const { io: planIo } = makeIo();
    await runCli(["plan", "--run-group", "rg-1", "--offline", "--mode", "sync"], planIo, { cwd: dir, env: {} }, { now: NOW });

    // Edit the suite file in place — a NEW item, changing suiteSpecHash.
    const mutated = buildFixtureSuite({ id: "demo-suite", positiveCount: 3, negativeCount: 2, k: 1 });
    writeFileSync(join(dir, "observatory", "suites", "demo-suite.suite.json"), canonicalStringify(mutated));

    const { io, err } = makeIo();
    const code = await runCli(
      ["run", "--plan", "rg-1"],
      io,
      { cwd: dir, env: { ANTHROPIC_API_KEY: "sk-fake" } },
      { now: NOW, buildClient: () => fakeClientAllPass() },
    );
    expect(code).toBe(CLI_EXIT.PLAN_STALE);
    expect(err.some((l) => l.includes("re-plan"))).toBe(true);
  });
});
