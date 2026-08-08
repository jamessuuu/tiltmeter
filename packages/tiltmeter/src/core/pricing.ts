/**
 * Pricing manifest (SPEC §7 `plan`, §8 run economics): "rates read from the
 * manifest, NEVER constants in code, incl. the Sonnet 5 intro-price end
 * date 2026-08-31 selecting the right row." A dated, checked-in,
 * machine-readable file (`observatory/pricing/pricing.2026-08-08.json`) —
 * this module only knows the shape and how to pick a row and price a token
 * count; it never hardcodes a rate.
 */
import { z } from "zod";

export const PricingRateSchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
});
export type PricingRate = z.infer<typeof PricingRateSchema>;

/**
 * One validity window for one model's pricing. `effectiveTo` is EXCLUSIVE
 * and `null` means open-ended (the current row) — a date exactly equal to
 * `effectiveTo` belongs to the NEXT row. This is what makes "the Sonnet 5
 * price change on 2026-08-31 selects the right row" (SPEC §12) a checkable
 * fact: the intro row's `effectiveTo` is `"2026-08-31"`, so a plan dated
 * `2026-08-30` still prices at intro, and one dated `2026-08-31` prices at
 * the new row.
 */
export const PricingRowSchema = z.object({
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().nullable(),
  standard: PricingRateSchema,
  batch: PricingRateSchema,
  /**
   * SPEC §7 `--offline`: multiplies the pure character-count input-token
   * heuristic (`core/cost.ts`) when `count_tokens` cannot be called.
   * `1.0` for models on the pre-4.7 tokenizer; the one named exception
   * (SPEC §8) is Fable 5 at `1.3` (+30% tokens, measured — never guessed —
   * whenever a real `count_tokens` call is available; SPEC §12 requires
   * count_tokens results, not this multiplier, to drive a Fable-5 estimate
   * whenever a client is present).
   */
  estimateMultiplier: z.number().positive(),
});
export type PricingRow = z.infer<typeof PricingRowSchema>;

export const PricingModelEntrySchema = z.object({
  modelId: z.string().min(1),
  rows: z.array(PricingRowSchema).min(1),
});
export type PricingModelEntry = z.infer<typeof PricingModelEntrySchema>;

export const PricingManifestSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string().min(1),
  fetchedAt: z.string().min(1),
  source: z.string().min(1),
  /**
   * SPEC §7: `count_tokens` only prices the INPUT side of a request — a
   * trial's completion length is unknowable before it runs (that is what a
   * reading's `cost.actualUsd` is for, once real usage exists). This is a
   * single global assumption about response-length behavior (SPEC §8's own
   * "measured ~1,700 in / ~100 out per trial"), not a tokenizer property,
   * so it lives once on the manifest rather than per model.
   */
  assumedOutputTokensPerTrial: z.number().int().positive(),
  models: z.array(PricingModelEntrySchema).min(1),
});
export type PricingManifest = z.infer<typeof PricingManifestSchema>;

export function parsePricingManifest(data: unknown): PricingManifest {
  return PricingManifestSchema.parse(data);
}

/** Truncate an ISO-8601 timestamp to its `YYYY-MM-DD` date-only prefix — the unit `selectPricingRow` compares in, so a full timestamp and a bare date compare consistently. */
export function toDateOnly(isoTimestamp: string): string {
  const datePart = isoTimestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new RangeError(`toDateOnly: not an ISO-8601 timestamp: ${isoTimestamp}`);
  }
  return datePart;
}

/**
 * Select the pricing row effective for `modelId` on `dateOnly`
 * (`YYYY-MM-DD` — pass through `toDateOnly` first if working from a
 * timestamp). Throws if the model has no entry, or no row covers the date
 * (a manifest gap — a data problem, never silently guessed).
 */
export function selectPricingRow(manifest: PricingManifest, modelId: string, dateOnly: string): PricingRow {
  const entry = manifest.models.find((m) => m.modelId === modelId);
  if (entry === undefined) {
    throw new RangeError(`pricing manifest "${manifest.id}" has no entry for model "${modelId}"`);
  }
  const row = entry.rows.find(
    (r) => dateOnly >= r.effectiveFrom && (r.effectiveTo === null || dateOnly < r.effectiveTo),
  );
  if (row === undefined) {
    throw new RangeError(`pricing manifest "${manifest.id}": no row for model "${modelId}" effective at ${dateOnly}`);
  }
  return row;
}

/** Price a token usage against one rate (SPEC §3.3 `cost.estimatedUsd`/`actualUsd`: dollars, per-MTok rates). */
export function priceUsage(usage: { in: number; out: number }, rate: PricingRate): number {
  return (usage.in / 1_000_000) * rate.inputPerMTok + (usage.out / 1_000_000) * rate.outputPerMTok;
}
