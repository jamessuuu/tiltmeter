import { describe, expect, it, vi } from "vitest";
import type { RequestPlan } from "../core/model-client.js";
import { isTiltmeterError } from "../core/errors.js";
import { AnthropicModelClient, parseBatchResultsJsonl } from "./anthropic.js";

/**
 * Every test in this file injects a fake `fetchImpl` — SPEC §9/§12: "NO
 * network in tests". This file never touches a real socket; it verifies
 * request construction and response mapping against a scripted fetch.
 */
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function textResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function plan(overrides: Partial<RequestPlan> = {}): RequestPlan {
  return {
    itemId: "item-1",
    system: "sys",
    tools: [],
    toolChoice: { type: "auto" },
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 512,
    temperature: 1,
    ...overrides,
  };
}

const NO_WAIT = { sleep: () => Promise.resolve(), random: () => 0 };

describe("AnthropicModelClient.runTrial", () => {
  it("maps a successful tool_use response to an ok TrialResult", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        model: "claude-haiku-4-5-20260615",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "Skill", input: { skill: "taste" } }],
        usage: { input_tokens: 1200, output_tokens: 40 },
      }),
    );
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    const result = await client.runTrial(plan(), 1, "claude-haiku-4-5");

    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      expect(result.response.modelIdResolved).toBe("claude-haiku-4-5-20260615");
      expect(result.response.toolUseBlocks).toEqual([{ type: "tool_use", name: "Skill", input: { skill: "taste" } }]);
      expect(result.response.usage).toEqual({ in: 1200, out: 40 });
      expect(result.response.stopReason).toBe("tool_use");
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("claude-haiku-4-5");
  });

  it("SPEC §9: a model 404 becomes noResult with modelUnavailable, never retried", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: { message: "model not found: some-internal-detail" } }));
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    const result = await client.runTrial(plan(), 1, "claude-nonexistent");

    expect(result).toMatchObject({ outcome: "noResult", modelUnavailable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never retried
    if (result.outcome === "noResult") {
      expect(result.reason).not.toContain("internal-detail"); // SECURITY.md: raw provider body never echoed
    }
  });

  it("SPEC §9: 429 is retried up to MAX_ATTEMPTS, then noResult (never thrown, never scored a fail)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: { message: "rate limited" } }, { "retry-after": "1" }));
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    const result = await client.runTrial(plan(), 1, "claude-haiku-4-5");

    expect(result.outcome).toBe("noResult");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS
  });

  it("recovers if a later attempt succeeds after transient 5xx failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(textResponse(529, "overloaded"))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [],
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
      );
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    const result = await client.runTrial(plan(), 1, "claude-haiku-4-5");
    expect(result.outcome).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a hard 400 is never retried and never echoes the raw body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "invalid_request: secret account detail" } }));
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    const result = await client.runTrial(plan(), 1, "claude-haiku-4-5");
    expect(result.outcome).toBe("noResult");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (result.outcome === "noResult") expect(result.reason).not.toContain("secret account detail");
  });
});

describe("AnthropicModelClient.countTokens", () => {
  it("returns the exact input_tokens from the free endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { input_tokens: 1723 }));
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    const result = await client.countTokens(plan(), "claude-sonnet-5");
    expect(result).toEqual({ inputTokens: 1723 });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
  });

  it("throws E_PROVIDER (never the raw body) on exhausted failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: "leaky internal detail" } }));
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    await expect(client.countTokens(plan(), "claude-sonnet-5")).rejects.toSatisfy(
      (err: unknown) => isTiltmeterError(err) && err.code === "E_PROVIDER" && !err.message.includes("leaky internal detail"),
    );
  });
});

describe("AnthropicModelClient batch operations", () => {
  it("submitBatch posts custom_id + params per request and returns the batch id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "batch_abc123" }));
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    const result = await client.submitBatch(
      [{ customId: "cid-1", plan: plan({ itemId: "item-1" }) }, { customId: "cid-2", plan: plan({ itemId: "item-2" }) }],
      "claude-haiku-4-5",
    );

    expect(result).toEqual({ batchId: "batch_abc123" });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { requests: { custom_id: string; params: { model: string } }[] };
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]?.custom_id).toBe("cid-1");
    expect(body.requests[0]?.params.model).toBe("claude-haiku-4-5");
  });

  it("pollBatch reports ended:true only when processing_status is 'ended'", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { processing_status: "in_progress" }))
      .mockResolvedValueOnce(jsonResponse(200, { processing_status: "ended" }));
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    expect(await client.pollBatch("batch_1")).toEqual({ ended: false });
    expect(await client.pollBatch("batch_1")).toEqual({ ended: true });
  });

  it("fetchBatchResults parses succeeded/errored/expired JSONL lines", async () => {
    const lines = [
      JSON.stringify({
        custom_id: "cid-1",
        result: { type: "succeeded", message: { model: "claude-haiku-4-5", stop_reason: "end_turn", content: [], usage: { input_tokens: 5, output_tokens: 1 } } },
      }),
      JSON.stringify({ custom_id: "cid-2", result: { type: "expired" } }),
      JSON.stringify({ custom_id: "cid-3", result: { type: "errored", error: { message: "boom" } } }),
    ];
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(200, lines.join("\n")));
    const client = new AnthropicModelClient({ apiKey: "sk-test", fetchImpl, backoffDeps: NO_WAIT });

    const results = await client.fetchBatchResults("batch_1");
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ customId: "cid-1", result: { outcome: "ok" } });
    expect(results[1]).toEqual({ customId: "cid-2", result: { outcome: "noResult", reason: "batch-expired" } });
    expect(results[2]).toEqual({ customId: "cid-3", result: { outcome: "noResult", reason: "batch-errored" } });
  });
});

describe("parseBatchResultsJsonl", () => {
  it("ignores blank lines", () => {
    const text = `${JSON.stringify({ custom_id: "a", result: { type: "canceled" } })}\n\n`;
    expect(parseBatchResultsJsonl(text)).toHaveLength(1);
  });

  it("empty text yields no results", () => {
    expect(parseBatchResultsJsonl("")).toEqual([]);
  });
});
