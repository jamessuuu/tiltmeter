/**
 * `tiltmeter lint` (SPEC §7/§14 M5): "schema, the negatives quota, ITEM
 * IMMUTABILITY vs git (fail on any in-place edit of a previously
 * published item), provenance level present, maxTokens headroom." Schema
 * is already enforced by `parseSuite` (Zod, SPEC §13) before any of this
 * runs. This module is pure (SPEC §6) — the git side of the immutability
 * check (finding the previously-committed version of a suite file) is
 * `src/node/git.ts`'s job; this file only knows how to compare two
 * already-resolved item sets and shape the suite-structure checks.
 */
import { jcsCanonical } from "./canonical.js";
import { activeItems, meetsNegativesQuota, type Item, type Suite } from "./suite.js";

export type LintIssueCode =
  | "negatives-quota"
  | "maxTokens-headroom"
  | "dangling-artifact-ref"
  | "item-edited-in-place"
  | "item-removed";

export interface LintIssue {
  code: LintIssueCode;
  message: string;
  itemId?: string;
}

export interface LintResult {
  suiteId: string;
  ok: boolean;
  issues: LintIssue[];
}

/**
 * SPEC §9's own headroom rule ("maxTokens ≥ 4× the largest expected
 * output") operationalized as a fixed floor, since a suite has no explicit
 * "largest expected output" field to read: `TYPICAL_TOOL_CALL_OUTPUT_TOKENS`
 * is a deliberately generous estimate for a structured tool-call JSON
 * response — larger than the ~100-token average this project's own
 * pricing manifest assumes (`assumedOutputTokensPerTrial`), so this check
 * is conservative in the safe direction rather than suite-specific.
 */
export const MIN_MAX_TOKENS_HEADROOM_MULTIPLE = 4;
export const TYPICAL_TOOL_CALL_OUTPUT_TOKENS = 128;

function lintStructure(suite: Suite): LintIssue[] {
  const issues: LintIssue[] = [];

  if (!meetsNegativesQuota(suite)) {
    const active = activeItems(suite);
    const negatives = active.filter((i) => i.polarity === "negative").length;
    const minRequired = Math.max(3, Math.ceil(active.length * 0.2));
    issues.push({
      code: "negatives-quota",
      message: `${String(negatives)} negatives < required ${String(minRequired)} (max(3, 20% of ${String(active.length)} active items))`,
    });
  }

  const minMaxTokens = MIN_MAX_TOKENS_HEADROOM_MULTIPLE * TYPICAL_TOOL_CALL_OUTPUT_TOKENS;
  if (suite.sampling.maxTokens < minMaxTokens) {
    issues.push({
      code: "maxTokens-headroom",
      message: `sampling.maxTokens ${String(suite.sampling.maxTokens)} < required ${String(minMaxTokens)} (${String(MIN_MAX_TOKENS_HEADROOM_MULTIPLE)}x headroom)`,
    });
  }

  const artifactIds = new Set(suite.artifacts.map((a) => a.id));
  for (const item of suite.items) {
    for (const ref of item.artifactRefs ?? []) {
      if (!artifactIds.has(ref)) {
        issues.push({
          code: "dangling-artifact-ref",
          itemId: item.id,
          message: `item "${item.id}" references unknown artifact "${ref}"`,
        });
      }
    }
  }

  // Provenance level ("present" — SPEC §13 E_PROVENANCE): structurally
  // guaranteed already — `ArtifactSourceSchema` (core/suite.ts) is a
  // discriminated union on `origin` with no optional/absent variant, so
  // `parseSuite` itself already rejects an artifact with no provenance
  // level before lint ever runs. Nothing further to check here; recorded
  // so a reader doesn't wonder why this bullet has no corresponding code.

  return issues;
}

/** An item's bytes EXCLUDING `retired` — SPEC §3.1 Decision 2: retiring an item (adding a `retired` block) is the one allowed "change"; every other field must stay byte-identical forever. */
function immutableBytesOf(item: Item): string {
  const { retired: _retired, ...rest } = item;
  return jcsCanonical(rest);
}

/**
 * SPEC §3.1 Decision 2's anti-p-hacking check, made concrete: for every
 * item id that existed in a PRIOR committed version of the suite
 * (`historicalItems` — resolved by the caller from git, e.g. the suite
 * file's content at `HEAD`), the current version must either (a) still
 * have that item with byte-identical non-`retired` fields, or (b) have
 * retired it (added/kept a `retired` block on top of otherwise-unchanged
 * fields) — never edited it, and never silently removed it (SPEC: "suites
 * grow by retirement, never by edit" — implicitly, never by removal
 * either, since a removed item's history becomes unauditable).
 */
export function checkItemImmutability(currentItems: readonly Item[], historicalItems: readonly Item[]): LintIssue[] {
  const currentById = new Map(currentItems.map((i) => [i.id, i]));
  const issues: LintIssue[] = [];
  for (const historical of historicalItems) {
    const current = currentById.get(historical.id);
    if (current === undefined) {
      issues.push({
        code: "item-removed",
        itemId: historical.id,
        message: `item "${historical.id}" was removed from the suite file — retire it (add a "retired" block) instead of deleting it`,
      });
      continue;
    }
    if (immutableBytesOf(current) !== immutableBytesOf(historical)) {
      issues.push({
        code: "item-edited-in-place",
        itemId: historical.id,
        message: `item "${historical.id}" changed in place since it was last committed — retire it and add a new id instead (SPEC §3.1 Decision 2)`,
      });
    }
  }
  return issues;
}

/** Combine the structural checks with an already-resolved immutability check into one suite-level verdict. `historicalItems` is `undefined` when the suite has no prior committed version at all (its very first commit) — nothing can have been edited in place yet. */
export function lintSuite(suite: Suite, historicalItems: readonly Item[] | undefined): LintResult {
  const issues = [...lintStructure(suite), ...checkItemImmutability(suite.items, historicalItems ?? [])];
  return { suiteId: suite.id, ok: issues.length === 0, issues };
}
