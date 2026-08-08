import { describe, expect, it } from "vitest";
import { evaluatePreRegistration, verifyCorpus, verifyReadingBodyHash, type PreRegistrationInput } from "./verify.js";
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

function preRegInput(overrides: Partial<PreRegistrationInput> = {}): PreRegistrationInput {
  return {
    suiteId: "house-skill-activation",
    cellId: "haiku45",
    runGroupId: "rg-1",
    modelIdRequested: "claude-haiku-4-5",
    suiteSpecHash: "abc123",
    registeredAtCommit: "deadbeef",
    suiteRegisteredAt: "2026-08-09",
    modelReleasedAt: "2026-09-01",
    modelSourceUrl: "https://www.anthropic.com/news/claude-haiku-4-5",
    ...overrides,
  };
}

describe("evaluatePreRegistration (SPEC §7: recompute suiteSpecHash, walk git, read models.json, assert registered < released)", () => {
  it("ok when the suite's registration commit predates the model's cited release", () => {
    const result = evaluatePreRegistration(preRegInput());
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("not ok when no commit in history reproduces the suiteSpecHash — the claim cannot be made at all", () => {
    const result = evaluatePreRegistration(preRegInput({ registeredAtCommit: undefined, suiteRegisteredAt: undefined }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no commit");
  });

  it("not ok when models.json has no entry for the requested model", () => {
    const result = evaluatePreRegistration(preRegInput({ modelReleasedAt: undefined, modelSourceUrl: undefined }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("models.json");
  });

  it("not ok when the suite was registered ON OR AFTER the model's release — the real, checkable failure case", () => {
    const result = evaluatePreRegistration(preRegInput({ suiteRegisteredAt: "2026-09-01", modelReleasedAt: "2026-06-30" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not before");
  });

  it("not ok on an exact tie (registered the same day as release — strictly-before, not on-or-before)", () => {
    const result = evaluatePreRegistration(preRegInput({ suiteRegisteredAt: "2026-06-30", modelReleasedAt: "2026-06-30" }));
    expect(result.ok).toBe(false);
  });

  it("carries every input field through on the result for the CLI to print (commit SHA, both dates)", () => {
    const result = evaluatePreRegistration(preRegInput());
    expect(result.registeredAtCommit).toBe("deadbeef");
    expect(result.suiteRegisteredAt).toBe("2026-08-09");
    expect(result.modelReleasedAt).toBe("2026-09-01");
  });
});
