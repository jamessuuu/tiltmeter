import { describe, expect, it } from "vitest";
import { appendEntry, computeEntryHash, parseIndex, serializeIndex, verifyChain, type IndexEntry } from "./index-chain.js";

function fields(runGroupId: string) {
  return {
    runGroupId,
    at: "2026-08-08T00:00:00.000Z",
    harnessCommit: "0000000000000000000000000000000000000",
    runnerBehaviorVersion: 1,
    cells: [{ suiteId: "suite-a", cellId: "haiku45", bodyHash: "sha256:aaa" }],
    status: "complete" as const,
    costUsd: 0.36,
  };
}

describe("appendEntry / verifyChain", () => {
  it("the first entry has prevHash null", () => {
    const entry = appendEntry([], fields("rg-1"));
    expect(entry.prevHash).toBeNull();
    expect(entry.hash.startsWith("sha256:")).toBe(true);
    expect(verifyChain([entry]).ok).toBe(true);
  });

  it("each subsequent entry's prevHash is the preceding entry's hash", () => {
    const e1 = appendEntry([], fields("rg-1"));
    const e2 = appendEntry([e1], fields("rg-2"));
    const e3 = appendEntry([e1, e2], fields("rg-3"));
    expect(e2.prevHash).toBe(e1.hash);
    expect(e3.prevHash).toBe(e2.hash);
    expect(verifyChain([e1, e2, e3]).ok).toBe(true);
  });

  it("is deterministic — the same fields in the same chain position hash identically", () => {
    const a = appendEntry([], fields("rg-1"));
    const b = appendEntry([], fields("rg-1"));
    expect(a.hash).toBe(b.hash);
  });

  it("different fields (even a single differing cell bodyHash) change the entry hash", () => {
    const a = appendEntry([], fields("rg-1"));
    const bFields = fields("rg-1");
    const [firstCell] = bFields.cells;
    if (firstCell === undefined) throw new Error("fixture has no cells");
    const b = appendEntry([], { ...bFields, cells: [{ ...firstCell, bodyHash: "sha256:bbb" }] });
    expect(a.hash).not.toBe(b.hash);
  });

  it("detects a tampered entry hash (a byte flipped after the fact)", () => {
    const e1 = appendEntry([], fields("rg-1"));
    const e2 = appendEntry([e1], fields("rg-2"));
    const tampered: IndexEntry = { ...e2, costUsd: 999 }; // mutate a field without recomputing hash
    const result = verifyChain([e1, tampered]);
    expect(result.ok).toBe(false);
    expect(result.brokenAtIndex).toBe(1);
  });

  it("detects a broken prevHash link (an entry spliced in or reordered)", () => {
    const e1 = appendEntry([], fields("rg-1"));
    const e2 = appendEntry([e1], fields("rg-2"));
    const e3 = appendEntry([e1, e2], fields("rg-3"));
    const result = verifyChain([e1, e3, e2]); // reordered
    expect(result.ok).toBe(false);
    expect(result.brokenAtIndex).toBe(1);
  });

  it("an empty chain verifies trivially (nothing to break)", () => {
    expect(verifyChain([]).ok).toBe(true);
  });

  it("computeEntryHash is independent of key order (canonical JSON, SPEC §3.3)", () => {
    const f = fields("rg-1");
    const h1 = computeEntryHash({ ...f, prevHash: null });
    const reordered = { prevHash: null, status: f.status, costUsd: f.costUsd, cells: f.cells, runGroupId: f.runGroupId, at: f.at, harnessCommit: f.harnessCommit, runnerBehaviorVersion: f.runnerBehaviorVersion };
    const h2 = computeEntryHash(reordered);
    expect(h1).toBe(h2);
  });
});

describe("serializeIndex / parseIndex round-trip", () => {
  it("round-trips a chain through canonical JSON", () => {
    const e1 = appendEntry([], fields("rg-1"));
    const e2 = appendEntry([e1], fields("rg-2"));
    const text = serializeIndex([e1, e2]);
    expect(text.endsWith("\n")).toBe(true);
    const parsed = parseIndex(JSON.parse(text));
    expect(parsed).toEqual([e1, e2]);
    expect(verifyChain(parsed).ok).toBe(true);
  });

  it("rejects a malformed entry", () => {
    expect(() => parseIndex([{ runGroupId: "rg-1" }])).toThrow();
  });
});
