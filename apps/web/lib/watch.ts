/**
 * Build-time read of the two things this observatory has genuinely PRODUCED
 * and never showed anyone (2026-09-07).
 *
 * 1. The index chain. Four scheduled run groups have fired since
 *    2026-08-10 and every one of them landed an honest `skipped` record —
 *    "ANTHROPIC_API_KEY not set" — hash-linked to its predecessor. That is
 *    not an empty observatory; it is a watch that has run four times and
 *    published a tamper-evident record of its own refusal each time. The
 *    site said "No readings for this suite yet." four times and left the
 *    chain itself invisible.
 *
 * 2. The cost planner's own time series. Each run group commits a
 *    `plan.json` priced from the dated pricing manifest. The plan is
 *    otherwise IDENTICAL across all four (same 12 cells, same 324 item
 *    runs, same k) — so when `claude-sonnet-5`'s published price rose on
 *    2026-08-31, the estimate for the same work moved on its own. That
 *    delta is a real, dated, checkable measurement this project made, and
 *    it is exactly the kind of drift the whole tool exists to catch.
 *
 * Everything here is a synchronous `fs` read that runs only during
 * `next build` (SPEC §6/§13, `output: "export"`). Nothing is fetched at
 * runtime — a page that fetches its own data can deploy green and render
 * empty.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parsePlan, type Plan, type IndexEntry } from "tiltmeter";
import { loadIndexChain, OBSERVATORY_DIR } from "./observatory.js";

export interface RunGroupRecord {
  entry: IndexEntry;
  plan: Plan | undefined;
  /** Short display hashes, git-log style. */
  hashShort: string;
  prevHashShort: string | undefined;
}

/** Strip the `sha256:` prefix the index stores, then shorten for display. */
export function shortDigest(hash: string): string {
  return hash.replace(/^sha256:/, "").slice(0, 10);
}

function loadPlan(runGroupId: string): Plan | undefined {
  const path = join(OBSERVATORY_DIR, "readings", runGroupId, "plan.json");
  if (!existsSync(path)) return undefined;
  return parsePlan(JSON.parse(readFileSync(path, "utf8")));
}

/** Every committed run group, oldest first, with its plan when one exists. */
export function loadRunGroupRecords(): RunGroupRecord[] {
  return loadIndexChain()
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((entry) => ({
      entry,
      plan: loadPlan(entry.runGroupId),
      hashShort: shortDigest(entry.hash),
      prevHashShort: entry.prevHash === null ? undefined : shortDigest(entry.prevHash),
    }));
}

/**
 * Does every entry's `prevHash` actually equal the previous entry's `hash`?
 * Computed, not asserted — the page states the chain is unbroken only
 * because this walked it at build time.
 */
export function chainIsUnbroken(records: readonly RunGroupRecord[]): boolean {
  for (let i = 0; i < records.length; i++) {
    const current = records[i];
    const previous = i === 0 ? undefined : records[i - 1];
    if (current === undefined) return false;
    const expected = previous === undefined ? null : previous.entry.hash;
    if (current.entry.prevHash !== expected) return false;
  }
  return true;
}

export interface CostShift {
  /** The two run groups whose identical plan priced differently. */
  fromRunGroupId: string;
  toRunGroupId: string;
  fromUsd: number;
  toUsd: number;
  deltaPct: number;
  /** The cells whose per-cell estimate actually moved. */
  movedCellIds: string[];
  /** True when both plans cover the same cells, k and item counts — i.e. the work did not change, only its price. */
  sameWork: boolean;
  itemRuns: number;
  cellCount: number;
}

const cellKey = (c: Plan["cells"][number]): string => `${c.suiteId}::${c.cellId}`;

/**
 * The most recent point at which the SAME planned work changed price.
 * Returns undefined when no two consecutive plans differ in total, which is
 * the honest answer for an observatory whose prices have never moved.
 */
export function findCostShift(records: readonly RunGroupRecord[]): CostShift | undefined {
  const withPlans = records.filter((r): r is RunGroupRecord & { plan: Plan } => r.plan !== undefined);
  for (let i = withPlans.length - 1; i >= 1; i--) {
    const prevRecord = withPlans[i - 1];
    const nextRecord = withPlans[i];
    if (prevRecord === undefined || nextRecord === undefined) continue;
    const prev = prevRecord.plan;
    const next = nextRecord.plan;
    const from = prev.totalEstimatedUsd;
    const to = next.totalEstimatedUsd;
    if (from === to) continue;

    const prevByKey = new Map(prev.cells.map((c) => [cellKey(c), c]));
    const nextByKey = new Map(next.cells.map((c) => [cellKey(c), c]));
    const sameCells =
      prevByKey.size === nextByKey.size && [...prevByKey.keys()].every((k) => nextByKey.has(k));
    const sameWork =
      sameCells &&
      [...prevByKey.entries()].every(([k, c]) => {
        const n = nextByKey.get(k);
        return n?.k === c.k && n.itemCount === c.itemCount;
      });
    const movedCellIds = [
      ...new Set(
        [...prevByKey.entries()]
          .filter(([k, c]) => (nextByKey.get(k)?.estimatedUsd ?? c.estimatedUsd) !== c.estimatedUsd)
          .map(([, c]) => c.cellId),
      ),
    ];

    return {
      fromRunGroupId: prev.runGroupId,
      toRunGroupId: next.runGroupId,
      fromUsd: from,
      toUsd: to,
      deltaPct: ((to - from) / from) * 100,
      movedCellIds,
      sameWork,
      itemRuns: next.cells.reduce((sum, c) => sum + c.itemCount, 0),
      cellCount: next.cells.length,
    };
  }
  return undefined;
}

/** The newest committed plan — what the next run group would cost. */
export function newestPlan(records: readonly RunGroupRecord[]): Plan | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const p = records[i]?.plan;
    if (p !== undefined) return p;
  }
  return undefined;
}

/** ISO date (no time) for compact display. */
export function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Dollars at the precision a sub-cent estimate actually carries. */
export function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

/** Count of pricing rows in the manifest whose window has already closed — i.e. prices that demonstrably changed. */
export function countClosedPriceRows(manifest: {
  models: readonly { modelId: string; rows: readonly { effectiveTo: string | null }[] }[];
}): number {
  return manifest.models.reduce(
    (sum, m) => sum + m.rows.filter((r) => r.effectiveTo !== null).length,
    0,
  );
}
