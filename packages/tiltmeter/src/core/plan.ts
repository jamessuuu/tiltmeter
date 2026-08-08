/**
 * `tiltmeter plan` (SPEC §7): "builds the run matrix, computes an EXACT
 * cost estimate via `count_tokens` per model … checks caps, writes
 * `plan.json` pinning `suiteSpecHash`. `--offline` falls back to the
 * manifest multiplier and marks the estimate `approximate`."
 */
import { z } from "zod";
import { activeItems, suiteSpecHash, type Suite } from "./suite.js";
import { presentationHash, renderPresentation, samplingPolicyHash, type Presentation } from "./presentation.js";
import type { ModelClient } from "./model-client.js";
import { CapsSchema, assertWithinCaps, checkCaps, type Caps } from "./caps.js";
import { offlineEstimatedInputTokens } from "./cost.js";
import { priceUsage, selectPricingRow, type PricingManifest } from "./pricing.js";
import { TiltmeterError } from "./errors.js";

/** SPEC §4/§8: one entry of the standing (or release) panel. `role: "null"` marks the mandatory null-pair cell — its `modelIdRequested` MUST match a non-null entry's, which is what `hasNullPair` below checks. */
export const PanelEntrySchema = z.object({
  cellId: z.string().min(1),
  modelIdRequested: z.string().min(1),
  role: z.enum(["standing", "null", "release"]),
  /** Overrides the suite's own `sampling.k` for this cell — SPEC §8: release-triggered runs use k=5. */
  kOverride: z.number().int().positive().optional(),
});
export type PanelEntry = z.infer<typeof PanelEntrySchema>;

export const PanelSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string().min(1),
  entries: z.array(PanelEntrySchema).min(1),
});
export type Panel = z.infer<typeof PanelSchema>;

export function parsePanel(data: unknown): Panel {
  return PanelSchema.parse(data);
}

/** SPEC §4: "every run group runs the cheapest panel model TWICE as two distinct cells … identical axes. It is the negative control." A pure structural check both `lint` (M5) and `plan` call: at least one `role: "null"` entry, and its model matches some non-null entry's. */
export function hasNullPair(panel: Panel): boolean {
  const nullEntries = panel.entries.filter((e) => e.role === "null");
  if (nullEntries.length === 0) return false;
  return nullEntries.every((nullEntry) =>
    panel.entries.some((e) => e.role !== "null" && e.modelIdRequested === nullEntry.modelIdRequested),
  );
}

export const PlanCellSchema = z.object({
  suiteId: z.string().min(1),
  cellId: z.string().min(1),
  modelIdRequested: z.string().min(1),
  suiteSpecHash: z.string().min(1),
  presentationHash: z.string().min(1),
  samplingPolicyHash: z.string().min(1),
  k: z.number().int().positive(),
  itemCount: z.number().int().nonnegative(),
  mode: z.enum(["batch", "sync"]),
  estimatedUsd: z.number().nonnegative(),
});
export type PlanCell = z.infer<typeof PlanCellSchema>;

export const PlanSchema = z.object({
  formatVersion: z.literal(1),
  runGroupId: z.string().min(1),
  createdAt: z.string().min(1),
  pricingManifestId: z.string().min(1),
  /** SPEC §7: true when built `--offline` — every `estimatedUsd` in `cells` is a heuristic, not a `count_tokens`-measured figure. */
  approximate: z.boolean(),
  caps: CapsSchema,
  monthToDateUsdAtPlan: z.number().nonnegative(),
  cells: z.array(PlanCellSchema),
  totalEstimatedUsd: z.number().nonnegative(),
});
export type Plan = z.infer<typeof PlanSchema>;

export function parsePlan(data: unknown): Plan {
  return PlanSchema.parse(data);
}

export interface PlanCellInput {
  suite: Suite;
  presentation: Presentation;
  entry: PanelEntry;
}

export interface BuildPlanOptions {
  runGroupId: string;
  cells: PlanCellInput[];
  pricing: PricingManifest;
  caps: Caps;
  /** Committed month-to-date (SPEC §8) — summed from `readings/index.json` by the caller (`core/caps.ts`'s `monthToDateUsd`), never guessed here. */
  monthToDateUsd: number;
  mode: "batch" | "sync";
  now: () => string;
  /** `YYYY-MM-DD` — the date pricing rows are selected against (SPEC §12: "asserts the Sonnet 5 price change on 2026-08-31 selects the right row"). */
  effectiveDate: string;
  /** `undefined` => `--offline` (SPEC §7): every cell's input-token estimate falls back to `core/cost.ts`'s heuristic and the whole plan is marked `approximate`. Present => the EXACT path, one `client.countTokens` call per active item (repeats send byte-identical content, so this is not called per-attempt). */
  client: ModelClient | undefined;
}

/**
 * Build the run matrix and its cost estimate (SPEC §7), then cap-check it
 * (SPEC §8) — throws `E_CAP` via `assertWithinCaps` rather than ever
 * returning an over-cap plan. Async because the online path calls
 * `client.countTokens`, the one legitimate network call `plan` makes (it is
 * a free, non-spending endpoint — SPEC §7's CLI table marks `plan` "no" for
 * spends).
 */
export async function buildPlan(options: BuildPlanOptions): Promise<Plan> {
  const { runGroupId, cells, pricing, caps, monthToDateUsd, mode, now, effectiveDate, client } = options;
  const approximate = client === undefined;
  const planCells: PlanCell[] = [];

  for (const { suite, presentation, entry } of cells) {
    const plans = renderPresentation(suite, presentation);
    const k = entry.kOverride ?? suite.sampling.k;
    const row = selectPricingRow(pricing, entry.modelIdRequested, effectiveDate);

    let totalInputTokens = 0;
    for (const plan of plans) {
      const perItemTokens =
        client === undefined
          ? offlineEstimatedInputTokens(plan, row.estimateMultiplier)
          : (await client.countTokens(plan, entry.modelIdRequested)).inputTokens;
      totalInputTokens += perItemTokens * k;
    }

    const itemCount = plans.length;
    const assumedOutputTokens = itemCount * k * pricing.assumedOutputTokensPerTrial;
    const rate = mode === "batch" ? row.batch : row.standard;
    const estimatedUsd = priceUsage({ in: totalInputTokens, out: assumedOutputTokens }, rate);

    planCells.push({
      suiteId: suite.id,
      cellId: entry.cellId,
      modelIdRequested: entry.modelIdRequested,
      suiteSpecHash: suiteSpecHash(suite),
      presentationHash: presentationHash(presentation),
      samplingPolicyHash: samplingPolicyHash(suite.sampling),
      k,
      itemCount,
      mode,
      estimatedUsd,
    });
  }

  const totalEstimatedUsd = planCells.reduce((sum, c) => sum + c.estimatedUsd, 0);
  const capResult = checkCaps({ caps, monthToDateUsd, cellEstimatesUsd: planCells.map((c) => c.estimatedUsd) });
  assertWithinCaps(capResult);

  return {
    formatVersion: 1,
    runGroupId,
    createdAt: now(),
    pricingManifestId: pricing.id,
    approximate,
    caps,
    monthToDateUsdAtPlan: monthToDateUsd,
    cells: planCells,
    totalEstimatedUsd,
  };
}

/** Number of ACTIVE items a suite would run — used by `buildPlan`'s callers/tests without re-rendering a full presentation. */
export function activeItemCount(suite: Suite): number {
  return activeItems(suite).length;
}

/**
 * SPEC §9 "Suite edited between plan and run": `plan.json` pins each cell's
 * `suiteSpecHash`; if the suite file has since moved to a different hash,
 * `run` must refuse rather than silently proceeding — E_PLAN_STALE, exit 4,
 * "re-plan" (SPEC §9's own words).
 */
export function assertPlanFresh(plan: Plan, currentSuiteSpecHashes: ReadonlyMap<string, string>): void {
  for (const cell of plan.cells) {
    const current = currentSuiteSpecHashes.get(cell.suiteId);
    if (current === undefined) continue; // a suite plan.json references that no longer exists is a different failure (E_PROVENANCE/lint territory, not staleness)
    if (current !== cell.suiteSpecHash) {
      throw new TiltmeterError(
        "E_PLAN_STALE",
        `plan.json pins suiteSpecHash "${cell.suiteSpecHash}" for suite "${cell.suiteId}", but the suite file's ` +
          `current hash is "${current}" — re-plan (\`tiltmeter plan\`) before running.`,
      );
    }
  }
}
