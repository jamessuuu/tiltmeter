import { describe, expect, it } from "vitest";
import { verifyCorpus, verifyGitPreRegistration, verifyReadingBodyHash } from "./verify.js";
import { appendEntry } from "./index-chain.js";
import { sha256Hex } from "./sha256.js";
import { jcsCanonical } from "./canonical.js";
import type { Reading, ReadingAxes } from "./reading.js";

const AXES: ReadingAxes = {
  suiteSpecHash: "hash-v1",
  modelIdRequested: "model-a",
  modelIdResolved: "model-a",
  aliasUsed: false,
  runnerBehaviorVersion: 1,
  presentationHash: "hash-presentation",
  samplingPolicyHash: "hash-sampling",
};

function readingWithValidBodyHash(overrides: Partial<Reading> = {}): Reading {
  const withoutHash = {
    formatVersion: 1 as const,
    runGroupId: "rg-1",
    suiteId: "suite-a",
    cellId: "cell-a",
    axes: AXES,
    harnessCommit: "0000000000000000000000000000000000000",
    runnerVersion: "0.1.0-alpha.0",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:00:01.000Z",
    status: "complete" as const,
    completeness: { expectedTrials: 0, ok: 0, error: 0, noResult: 0 },
    metrics: {},
    items: [],
    ...overrides,
  };
  const bodyHash = `sha256:${sha256Hex(jcsCanonical(withoutHash))}`;
  return { ...withoutHash, bodyHash };
}

describe("verifyReadingBodyHash", () => {
  it("passes for a reading whose bodyHash matches its own canonicalized fields", () => {
    expect(verifyReadingBodyHash(readingWithValidBodyHash())).toBe(true);
  });

  it("fails when any field changed after the bodyHash was computed", () => {
    const reading = readingWithValidBodyHash();
    const tampered: Reading = { ...reading, metrics: { overall: 0.99 } };
    expect(verifyReadingBodyHash(tampered)).toBe(false);
  });

  it("fails when bodyHash itself was tampered with directly", () => {
    const reading = readingWithValidBodyHash();
    expect(verifyReadingBodyHash({ ...reading, bodyHash: "sha256:0000" })).toBe(false);
  });
});

describe("verifyCorpus", () => {
  it("ok when every reading's body hash is valid and the index chain verifies", () => {
    const a = readingWithValidBodyHash({ cellId: "a" });
    const b = readingWithValidBodyHash({ cellId: "b" });
    const entry = appendEntry([], {
      runGroupId: "rg-1",
      at: "2026-08-08T00:00:00.000Z",
      harnessCommit: "0000000000000000000000000000000000000",
      runnerBehaviorVersion: 1,
      cells: [
        { suiteId: a.suiteId, cellId: a.cellId, bodyHash: a.bodyHash },
        { suiteId: b.suiteId, cellId: b.cellId, bodyHash: b.bodyHash },
      ],
      status: "complete",
      costUsd: 0.72,
    });
    const result = verifyCorpus([a, b], [entry]);
    expect(result.ok).toBe(true);
    expect(result.readings).toHaveLength(2);
    expect(result.readings.every((r) => r.ok)).toBe(true);
    expect(result.chain.ok).toBe(true);
  });

  it("not ok when one reading's body hash was tampered, even if the chain itself verifies", () => {
    const a = readingWithValidBodyHash({ cellId: "a" });
    const tampered: Reading = { ...a, cellId: "a", metrics: { overall: 0.5 } }; // bodyHash now stale
    const result = verifyCorpus([tampered], []);
    expect(result.ok).toBe(false);
    expect(result.readings[0]?.ok).toBe(false);
  });

  it("not ok when the index chain is broken, even if every reading's own body hash is valid", () => {
    const a = readingWithValidBodyHash({ cellId: "a" });
    const entry = appendEntry([], {
      runGroupId: "rg-1",
      at: "2026-08-08T00:00:00.000Z",
      harnessCommit: "0000000000000000000000000000000000000",
      runnerBehaviorVersion: 1,
      cells: [{ suiteId: a.suiteId, cellId: a.cellId, bodyHash: a.bodyHash }],
      status: "complete",
      costUsd: 0.36,
    });
    const tamperedEntry = { ...entry, costUsd: 999 };
    const result = verifyCorpus([a], [tamperedEntry]);
    expect(result.ok).toBe(false);
    expect(result.chain.ok).toBe(false);
  });

  it("an empty corpus verifies trivially", () => {
    expect(verifyCorpus([], []).ok).toBe(true);
  });
});

describe("verifyGitPreRegistration (M2 stub — M5 lands the real git walk)", () => {
  it("never reports a pass — its return type has no ok field to misread", () => {
    const result = verifyGitPreRegistration();
    expect(result.implemented).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
    expect(Object.keys(result)).not.toContain("ok");
  });
});
