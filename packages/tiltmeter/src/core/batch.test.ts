import { describe, expect, it } from "vitest";
import { FakeModelClient, toolUseTrial, noResultTrial } from "../testing/index.js";
import type { RequestPlan } from "./model-client.js";
import {
  batchCustomId,
  collectCellBatchResults,
  computeCellCustomIds,
  hasRecordedBatch,
  retryCellBatch,
  submitCellBatch,
  type RunRecordCell,
} from "./batch.js";

function plan(itemId: string): RequestPlan {
  return {
    itemId,
    system: "sys",
    tools: [],
    toolChoice: { type: "auto" },
    messages: [{ role: "user", content: `scenario for ${itemId}` }],
    maxTokens: 512,
    temperature: 1,
  };
}

describe("batchCustomId (SPEC §9: sha256(runGroup,suite,item,trial))", () => {
  it("is deterministic", () => {
    expect(batchCustomId("rg-1", "suite-a", "item-1", 1)).toBe(batchCustomId("rg-1", "suite-a", "item-1", 1));
  });

  it("differs when any input differs", () => {
    const base = batchCustomId("rg-1", "suite-a", "item-1", 1);
    expect(batchCustomId("rg-2", "suite-a", "item-1", 1)).not.toBe(base);
    expect(batchCustomId("rg-1", "suite-b", "item-1", 1)).not.toBe(base);
    expect(batchCustomId("rg-1", "suite-a", "item-2", 1)).not.toBe(base);
    expect(batchCustomId("rg-1", "suite-a", "item-1", 2)).not.toBe(base);
  });
});

describe("computeCellCustomIds", () => {
  it("emits k custom ids per item, in attempt order", () => {
    const ids = computeCellCustomIds("rg-1", "suite-a", ["item-1", "item-2"], 3);
    expect(Object.keys(ids)).toEqual(["item-1", "item-2"]);
    expect(ids["item-1"]).toHaveLength(3);
    expect(ids["item-1"]?.[0]).toBe(batchCustomId("rg-1", "suite-a", "item-1", 1));
    expect(ids["item-1"]?.[2]).toBe(batchCustomId("rg-1", "suite-a", "item-1", 3));
  });
});

describe("hasRecordedBatch / the duplicate-spend guard (SPEC §9)", () => {
  it("false when no batchId is recorded", () => {
    expect(hasRecordedBatch({ batchId: undefined })).toBe(false);
  });

  it("true once a batchId is recorded", () => {
    expect(hasRecordedBatch({ batchId: "batch-123" })).toBe(true);
  });
});

describe("submitCellBatch", () => {
  it("submits a fresh cell and records customIds + the returned batchId", async () => {
    const client = new FakeModelClient({ script: {} });
    const cell = await submitCellBatch(client, "rg-1", "suite-a", "haiku45", "claude-haiku-4-5", [plan("item-1"), plan("item-2")], 2, undefined);
    expect(cell.status).toBe("submitted");
    expect(cell.batchId).toBeDefined();
    expect(cell.customIds["item-1"]).toHaveLength(2);
    expect(cell.customIds["item-2"]).toHaveLength(2);
  });

  it("SPEC §9 duplicate-spend guard: a cell with a recorded batchId is returned unchanged, never resubmitted", async () => {
    const client = new FakeModelClient({ script: {} });
    let submitCount = 0;
    const originalSubmit = client.submitBatch.bind(client);
    client.submitBatch = (...args) => {
      submitCount++;
      return originalSubmit(...args);
    };
    const existing: RunRecordCell = {
      suiteId: "suite-a",
      cellId: "haiku45",
      modelIdRequested: "claude-haiku-4-5",
      mode: "batch",
      customIds: { "item-1": ["deadbeef"] },
      batchId: "already-submitted-batch",
      status: "submitted",
    };
    const cell = await submitCellBatch(client, "rg-1", "suite-a", "haiku45", "claude-haiku-4-5", [plan("item-1")], 1, existing);
    expect(cell).toBe(existing);
    expect(submitCount).toBe(0);
  });
});

describe("collectCellBatchResults", () => {
  it("maps batch results back to (itemId, attempt) via customId", async () => {
    const client = new FakeModelClient({ script: {} });
    const cell = await submitCellBatch(client, "rg-1", "suite-a", "cell-a", "claude-haiku-4-5", [plan("item-1")], 2, undefined);
    const id1 = cell.customIds["item-1"]?.[0];
    const id2 = cell.customIds["item-1"]?.[1];
    if (id1 === undefined || id2 === undefined) throw new Error("expected 2 custom ids");
    client.scriptByCustomId(id1, toolUseTrial("Skill", { skill: "taste" }));
    client.scriptByCustomId(id2, toolUseTrial("Skill", { skill: "taste" }));

    const { trialsByItem, cell: collected } = await collectCellBatchResults(client, cell);
    expect(collected.status).toBe("complete");
    expect(trialsByItem.get("item-1")).toHaveLength(2);
    expect(trialsByItem.get("item-1")?.[0]?.outcome).toBe("ok");
  });

  it("SPEC §9 batch-expiry: a noResult result is flagged for retry, and the cell is not yet complete", async () => {
    const client = new FakeModelClient({ script: {} });
    const cell = await submitCellBatch(client, "rg-1", "suite-a", "cell-a", "claude-haiku-4-5", [plan("item-1")], 1, undefined);
    const id1 = cell.customIds["item-1"]?.[0];
    if (id1 === undefined) throw new Error("expected a custom id");
    client.scriptByCustomId(id1, noResultTrial("batch-expired"));

    const { cell: collected } = await collectCellBatchResults(client, cell);
    expect(collected.status).toBe("submitted"); // not final yet — a retry is pending
    expect(collected.retriedCustomIds).toEqual([id1]);
  });

  it("throws if called before the cell has ever been submitted", async () => {
    const client = new FakeModelClient({ script: {} });
    const neverSubmitted: RunRecordCell = {
      suiteId: "suite-a",
      cellId: "cell-a",
      modelIdRequested: "claude-haiku-4-5",
      mode: "batch",
      customIds: {},
      status: "pending",
    };
    await expect(collectCellBatchResults(client, neverSubmitted)).rejects.toThrow();
  });
});

describe("retryCellBatch (SPEC §9: exactly one retry of only the failed custom_id set)", () => {
  it("resends only the failed customIds and merges the retry result in", async () => {
    const client = new FakeModelClient({ script: {} });
    const plans = [plan("item-1"), plan("item-2")];
    let cell = await submitCellBatch(client, "rg-1", "suite-a", "cell-a", "claude-haiku-4-5", plans, 1, undefined);
    const id1 = cell.customIds["item-1"]?.[0];
    const id2 = cell.customIds["item-2"]?.[0];
    if (id1 === undefined || id2 === undefined) throw new Error("expected custom ids");
    client.scriptByCustomId(id1, noResultTrial("batch-expired"));
    client.scriptByCustomId(id2, toolUseTrial("Skill", { skill: "taste" }));

    const collected = await collectCellBatchResults(client, cell);
    cell = collected.cell;
    expect(cell.retriedCustomIds).toEqual([id1]);

    // On retry, item-1 now succeeds (a second submission of the same request).
    client.scriptByCustomId(id1, toolUseTrial("Skill", { skill: "taste" }));
    const retried = await retryCellBatch(client, cell, plans, collected.trialsByItem);
    expect(retried.cell.status).toBe("complete");
    expect(retried.cell.retryBatchId).toBeDefined();
    expect(retried.trialsByItem.get("item-1")?.[0]?.outcome).toBe("ok");
    expect(retried.trialsByItem.get("item-2")?.[0]?.outcome).toBe("ok"); // untouched by the retry
  });

  it("is a no-op if there is nothing to retry", async () => {
    const client = new FakeModelClient({ script: {} });
    const plans = [plan("item-1")];
    const cell = await submitCellBatch(client, "rg-1", "suite-a", "cell-a", "claude-haiku-4-5", plans, 1, undefined);
    const result = await retryCellBatch(client, cell, plans, new Map());
    expect(result.cell).toBe(cell);
  });

  it("never retries a second time — calling again after retryBatchId is set is a no-op", async () => {
    const client = new FakeModelClient({ script: {} });
    const plans = [plan("item-1")];
    let cell = await submitCellBatch(client, "rg-1", "suite-a", "cell-a", "claude-haiku-4-5", plans, 1, undefined);
    const id1 = cell.customIds["item-1"]?.[0];
    if (id1 === undefined) throw new Error("expected a custom id");
    client.scriptByCustomId(id1, noResultTrial("batch-expired"));
    const collected = await collectCellBatchResults(client, cell);
    cell = collected.cell;

    let submitCount = 0;
    const originalSubmit = client.submitBatch.bind(client);
    client.submitBatch = (...args) => {
      submitCount++;
      return originalSubmit(...args);
    };
    const first = await retryCellBatch(client, cell, plans, collected.trialsByItem);
    expect(submitCount).toBe(1);
    const second = await retryCellBatch(client, first.cell, plans, first.trialsByItem);
    expect(submitCount).toBe(1); // no second network call
    expect(second.cell).toBe(first.cell);
  });
});
