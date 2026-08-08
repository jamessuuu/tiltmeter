import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  parsePricingManifest,
  priceUsage,
  selectPricingRow,
  toDateOnly,
  type PricingManifest,
} from "./pricing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/tiltmeter/src/core -> repo root is four levels up.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function loadCommittedManifest(): PricingManifest {
  const raw = readFileSync(join(REPO_ROOT, "observatory", "pricing", "pricing.2026-08-08.json"), "utf8");
  return parsePricingManifest(JSON.parse(raw));
}

describe("pricing manifest (SPEC §8 rates)", () => {
  it("parses the committed observatory/pricing/pricing.2026-08-08.json", () => {
    expect(() => loadCommittedManifest()).not.toThrow();
  });

  it("SPEC §12: the Sonnet 5 price change on 2026-08-31 selects the right row", () => {
    const manifest = loadCommittedManifest();
    const before = selectPricingRow(manifest, "claude-sonnet-5", "2026-08-30");
    const onChangeDay = selectPricingRow(manifest, "claude-sonnet-5", "2026-08-31");
    const after = selectPricingRow(manifest, "claude-sonnet-5", "2026-09-15");

    expect(before.batch).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
    expect(onChangeDay.batch).toEqual({ inputPerMTok: 1.5, outputPerMTok: 7.5 });
    expect(after.batch).toEqual({ inputPerMTok: 1.5, outputPerMTok: 7.5 });
  });

  it("throws for an unknown model id rather than guessing", () => {
    const manifest = loadCommittedManifest();
    expect(() => selectPricingRow(manifest, "claude-nonexistent", "2026-08-08")).toThrow(/no entry/);
  });

  it("throws when no row covers the requested date (a manifest gap)", () => {
    const manifest = loadCommittedManifest();
    expect(() => selectPricingRow(manifest, "claude-haiku-4-5", "2020-01-01")).toThrow(/no row/);
  });

  it("toDateOnly truncates a full ISO timestamp to YYYY-MM-DD", () => {
    expect(toDateOnly("2026-08-31T03:00:00.000Z")).toBe("2026-08-31");
  });

  it("toDateOnly rejects a non-ISO string", () => {
    expect(() => toDateOnly("not-a-date")).toThrow();
  });

  it("SPEC §8: a Haiku 4.5 reading (330 batch trials, ~1700 in/~100 out) prices to ~$0.36", () => {
    const manifest = loadCommittedManifest();
    const row = selectPricingRow(manifest, "claude-haiku-4-5", "2026-08-08");
    const usd = priceUsage({ in: 1700 * 330, out: 100 * 330 }, row.batch);
    expect(usd).toBeCloseTo(0.36, 2);
  });

  it("SPEC §8: the same cell on Sonnet 5 intro batch pricing is ~$0.73, and ~$1.09 after 2026-08-31", () => {
    const manifest = loadCommittedManifest();
    const introRow = selectPricingRow(manifest, "claude-sonnet-5", "2026-08-08");
    const afterRow = selectPricingRow(manifest, "claude-sonnet-5", "2026-09-01");
    const usage = { in: 1700 * 330, out: 100 * 330 };
    expect(priceUsage(usage, introRow.batch)).toBeCloseTo(0.73, 2);
    expect(priceUsage(usage, afterRow.batch)).toBeCloseTo(1.09, 2);
  });

  it("Fable 5's row carries the +30% estimateMultiplier (SPEC §8), the other three models do not", () => {
    const manifest = loadCommittedManifest();
    expect(selectPricingRow(manifest, "claude-fable-5", "2026-08-08").estimateMultiplier).toBe(1.3);
    expect(selectPricingRow(manifest, "claude-haiku-4-5", "2026-08-08").estimateMultiplier).toBe(1.0);
    expect(selectPricingRow(manifest, "claude-sonnet-5", "2026-08-08").estimateMultiplier).toBe(1.0);
    expect(selectPricingRow(manifest, "claude-opus-5", "2026-08-08").estimateMultiplier).toBe(1.0);
  });
});

describe("priceUsage", () => {
  it("prices input and output tokens independently", () => {
    const usd = priceUsage({ in: 1_000_000, out: 1_000_000 }, { inputPerMTok: 1, outputPerMTok: 5 });
    expect(usd).toBe(6);
  });

  it("zero usage prices to zero", () => {
    expect(priceUsage({ in: 0, out: 0 }, { inputPerMTok: 1, outputPerMTok: 5 })).toBe(0);
  });
});
