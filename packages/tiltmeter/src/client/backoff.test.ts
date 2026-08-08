import { describe, expect, it } from "vitest";
import { fullJitterDelayMs, MAX_ATTEMPTS, parseRetryAfterSeconds, withFullJitterRetry } from "./backoff.js";

describe("fullJitterDelayMs", () => {
  it("honors an explicit Retry-After over computed jitter", () => {
    expect(fullJitterDelayMs(1, 2)).toBe(2000);
    expect(fullJitterDelayMs(3, 0.5)).toBe(500);
  });

  it("full-jitter: random(0, min(cap, base*2^attempt)) — bounded by the cap and never negative", () => {
    const delay = fullJitterDelayMs(5, undefined, { random: () => 1, baseMs: 500, capMs: 8000 });
    expect(delay).toBeLessThanOrEqual(8000);
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it("random()=0 always yields a zero delay", () => {
    expect(fullJitterDelayMs(1, undefined, { random: () => 0 })).toBe(0);
  });

  it("grows with attempt number up to the cap (same random seed)", () => {
    const random = () => 0.999999;
    const d1 = fullJitterDelayMs(1, undefined, { random, baseMs: 100, capMs: 100_000 });
    const d2 = fullJitterDelayMs(2, undefined, { random, baseMs: 100, capMs: 100_000 });
    expect(d2).toBeGreaterThan(d1);
  });
});

describe("parseRetryAfterSeconds", () => {
  it("parses a plain integer-seconds header", () => {
    expect(parseRetryAfterSeconds("30")).toBe(30);
  });

  it("returns undefined for a null header", () => {
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
  });

  it("returns undefined for an unparseable header", () => {
    expect(parseRetryAfterSeconds("not-a-number-or-date")).toBeUndefined();
  });
});

describe("withFullJitterRetry (SPEC §9: full-jitter backoff, <=3 attempts, Retry-After honoured)", () => {
  it("succeeds on the first attempt without sleeping", async () => {
    let sleepCalls = 0;
    const result = await withFullJitterRetry(
      () => Promise.resolve({ ok: true as const, value: "done" }),
      { sleep: () => { sleepCalls++; return Promise.resolve(); } },
    );
    expect(result).toEqual({ ok: true, value: "done" });
    expect(sleepCalls).toBe(0);
  });

  it("retries a retryable failure and succeeds on a later attempt, sleeping between tries", async () => {
    let attempts = 0;
    let sleeps = 0;
    const result = await withFullJitterRetry(
      () => {
        attempts++;
        if (attempts < 2) return Promise.resolve({ ok: false as const, retryable: true, reason: "529" });
        return Promise.resolve({ ok: true as const, value: "recovered" });
      },
      { sleep: () => { sleeps++; return Promise.resolve(); }, random: () => 0.5 },
    );
    expect(result).toEqual({ ok: true, value: "recovered" });
    expect(attempts).toBe(2);
    expect(sleeps).toBe(1);
  });

  it("SPEC §9 '<=3 attempts': stops after MAX_ATTEMPTS even if every attempt is retryable, never scoring it a thrown error", async () => {
    let attempts = 0;
    const result = await withFullJitterRetry(
      () => {
        attempts++;
        return Promise.resolve({ ok: false as const, retryable: true, reason: "still 529" });
      },
      { sleep: () => Promise.resolve() },
    );
    expect(attempts).toBe(MAX_ATTEMPTS);
    expect(result).toEqual({ ok: false, reason: "still 529" });
  });

  it("a non-retryable failure stops immediately without spending remaining attempts", async () => {
    let attempts = 0;
    const result = await withFullJitterRetry(
      () => {
        attempts++;
        return Promise.resolve({ ok: false as const, retryable: false, reason: "400 bad request" });
      },
      { sleep: () => Promise.resolve() },
    );
    expect(attempts).toBe(1);
    expect(result).toEqual({ ok: false, reason: "400 bad request" });
  });

  it("honors a per-attempt Retry-After passed back by the operation", async () => {
    const sleptMs: number[] = [];
    let attempts = 0;
    await withFullJitterRetry(
      () => {
        attempts++;
        if (attempts < 2) return Promise.resolve({ ok: false as const, retryable: true, reason: "429", retryAfterSeconds: 3 });
        return Promise.resolve({ ok: true as const, value: "ok" });
      },
      { sleep: (ms) => { sleptMs.push(ms); return Promise.resolve(); } },
    );
    expect(sleptMs).toEqual([3000]);
  });
});
