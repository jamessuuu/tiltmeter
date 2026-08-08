/**
 * `runScheduledReading` (SPEC §8/§9 M7) — what `reading.yml` actually
 * invokes. Mirrors `plan-run.test.ts`'s scaffold-a-temp-observatory
 * pattern; every run injects `FakeModelClient` (SPEC §9/§12: "NO live
 * smoke run", "NO network in tests").
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalStringify } from "../../core/canonical.js";
import { appendEntry, type IndexEntry } from "../../core/index-chain.js";
import { FakeModelClient, allPassBehavior, scriptForBehavior } from "../../testing/index.js";
import { buildFixtureSuite, FIXTURE_PRESENTATION } from "../../testing/fixtures.js";
import type { ModelClient } from "../../core/model-client.js";
import { CLI_EXIT } from "../exit-codes.js";
import { runScheduledReading } from "./scheduled-reading.js";

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
}

const NOW = () => "2026-08-11T03:00:00.000Z"; // a Monday, matching reading.yml's schedule
const HARNESS_COMMIT = "deadbeef";

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

/** Seed `readings/index.json` with entries whose `costUsd` sum to `totalUsd` for THIS month (SPEC §8: month-to-date is a committed number). Built with the real `appendEntry` so the hash chain stays valid. */
function seedMonthToDateUsd(totalUsd: number): void {
  const monthPrefix = NOW().slice(0, 7);
  const entries: IndexEntry[] = [];
  const entry = appendEntry(entries, {
    runGroupId: "rg-seed",
    at: `${monthPrefix}-01T00:00:00.000Z`,
    harnessCommit: HARNESS_COMMIT,
    runnerBehaviorVersion: 1,
    cells: [{ suiteId: "demo-suite", cellId: "haiku45", bodyHash: "sha256:seed" }],
    status: "complete",
    costUsd: totalUsd,
  });
  mkdirSync(join(dir, "observatory", "readings"), { recursive: true });
  writeFileSync(join(dir, "observatory", "readings", "index.json"), canonicalStringify([entry]));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tiltmeter-scheduled-reading-"));
  scaffoldObservatory();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runScheduledReading", () => {
  it("no key configured: exits clean, writes ONE skipped index entry naming ANTHROPIC_API_KEY, never spends", async () => {
    const { io, err } = makeIo();
    const code = await runScheduledReading(
      io,
      { runGroupId: "rg-1", mode: "batch" },
      { cwd: dir, env: {}, now: NOW, harnessCommit: HARNESS_COMMIT },
    );
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(err.some((l) => l.includes("ANTHROPIC_API_KEY"))).toBe(true);

    const index = JSON.parse(readFileSync(join(dir, "observatory", "readings", "index.json"), "utf8")) as {
      status: string;
      reason?: string;
    }[];
    expect(index).toHaveLength(1);
    expect(index[0]?.status).toBe("skipped");
    expect(index[0]?.reason).toContain("ANTHROPIC_API_KEY");
  });

  it("monthly cap already reached before planning: writes ONE skipped entry naming the cap, never calls plan/run at all", async () => {
    seedMonthToDateUsd(15.5); // already over DEFAULT_CAPS.maxMonthUsd = 15.0
    const { io, out } = makeIo();
    const code = await runScheduledReading(
      io,
      { runGroupId: "rg-2", mode: "batch" },
      { cwd: dir, env: { ANTHROPIC_API_KEY: "sk-fake" }, now: NOW, harnessCommit: HARNESS_COMMIT, buildClient: () => fakeClientAllPass() },
    );
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.some((l) => l.toLowerCase().includes("cap"))).toBe(true);

    const index = JSON.parse(readFileSync(join(dir, "observatory", "readings", "index.json"), "utf8")) as {
      runGroupId: string;
      status: string;
      reason?: string;
    }[];
    expect(index).toHaveLength(2); // the seeded entry + the new skipped one
    const newest = index[1];
    expect(newest?.runGroupId).toBe("rg-2");
    expect(newest?.status).toBe("skipped");
    expect(newest?.reason).toContain("cap");
    // Never a silent gap: no plan.json/run.json were written for rg-2.
    expect(() => readFileSync(join(dir, "observatory", "readings", "rg-2", "plan.json"), "utf8")).toThrow();
  });

  it("plan itself refuses on cap grounds (race past the preflight): still a committed skipped entry, never a crash", async () => {
    // Preflight uses an EMPTY cell-estimate list, so it only compares
    // committed month-to-date against the cap. Seed it just under the cap
    // so the preflight passes, but ANY positive estimated run cost (plan's
    // OWN, real --offline check) tips the month total over — reproducing
    // the race the second skip path exists for. No key needed: the
    // --offline heuristic estimate alone is enough to trip it.
    seedMonthToDateUsd(14.9999999);
    const { io, out } = makeIo();
    const code = await runScheduledReading(
      io,
      { runGroupId: "rg-3", mode: "batch" },
      { cwd: dir, env: {}, now: NOW, harnessCommit: HARNESS_COMMIT },
    );
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.some((l) => l.toLowerCase().includes("cap"))).toBe(true);

    const index = JSON.parse(readFileSync(join(dir, "observatory", "readings", "index.json"), "utf8")) as {
      runGroupId: string;
      status: string;
    }[];
    expect(index).toHaveLength(2);
    expect(index[1]?.runGroupId).toBe("rg-3");
    expect(index[1]?.status).toBe("skipped");
  });

  it("key present, cap clear: runs end-to-end and commits a complete index entry", async () => {
    const { io, out } = makeIo();
    const code = await runScheduledReading(
      io,
      { runGroupId: "rg-4", mode: "sync" },
      { cwd: dir, env: { ANTHROPIC_API_KEY: "sk-fake" }, now: NOW, harnessCommit: HARNESS_COMMIT, buildClient: () => fakeClientAllPass() },
    );
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.some((l) => l.includes("complete"))).toBe(true);

    const index = JSON.parse(readFileSync(join(dir, "observatory", "readings", "index.json"), "utf8")) as {
      runGroupId: string;
      status: string;
    }[];
    expect(index).toHaveLength(1);
    expect(index[0]?.runGroupId).toBe("rg-4");
    expect(index[0]?.status).toBe("complete");

    const reading = JSON.parse(
      readFileSync(join(dir, "observatory", "readings", "rg-4", "demo-suite__haiku45.json"), "utf8"),
    ) as { harnessCommit: string };
    expect(reading.harnessCommit).toBe(HARNESS_COMMIT);
  });

  it("a genuine configuration error (no suites) propagates rather than being swallowed as a skip", async () => {
    rmSync(join(dir, "observatory", "suites", "demo-suite.suite.json"));
    const { io } = makeIo();
    const code = await runScheduledReading(
      io,
      { runGroupId: "rg-5", mode: "batch" },
      { cwd: dir, env: {}, now: NOW, harnessCommit: HARNESS_COMMIT },
    );
    expect(code).not.toBe(CLI_EXIT.CLEAN);
  });
});
