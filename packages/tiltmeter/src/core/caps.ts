/**
 * Cost caps (SPEC §8): "runner-enforced `maxRunUsd` = 3.00, `maxCellUsd` =
 * 1.50, `maxMonthUsd` = 15.00 tracked in `readings/index.json` month-to-date
 * (a committed number, not a guess). `plan` refuses to emit a plan that
 * exceeds any cap; `run` re-checks against ACTUAL usage after each cell
 * and, on breach, stops submitting, writes the reading as `aborted` with
 * `abortedBy: 'cap'`, and commits. Never a silent skip."
 *
 * This module is the pure decision layer both `plan` (against ESTIMATES,
 * `checkCaps`/`assertWithinCaps`) and `run` (against ACTUALS after each
 * cell, `capBreachAfterCell`) call — neither does any I/O or throws on its
 * own initiative; the caller decides what to do with the result.
 */
import { z } from "zod";
import { TiltmeterError } from "./errors.js";

export const CapsSchema = z.object({
  maxRunUsd: z.number().positive(),
  maxCellUsd: z.number().positive(),
  maxMonthUsd: z.number().positive(),
});
export type Caps = z.infer<typeof CapsSchema>;

/** SPEC §8's own numbers — the standing default; `observatory/` may override in a config file, but nothing in this package hardcodes them anywhere except here, once. */
export const DEFAULT_CAPS: Caps = { maxRunUsd: 3.0, maxCellUsd: 1.5, maxMonthUsd: 15.0 };

export type CapViolationKind = "cell" | "run" | "month";

export interface CapViolation {
  kind: CapViolationKind;
  limitUsd: number;
  wouldBeUsd: number;
  /** Present only for `kind === "cell"` — which planned cell (by index into the caller's own cell list) tripped it. */
  cellIndex?: number;
}

export interface CapCheckInput {
  caps: Caps;
  /** Committed, not estimated (SPEC §8) — the sum of `costUsd` for this calendar month's `readings/index.json` entries so far, BEFORE this run. */
  monthToDateUsd: number;
  /** One estimated (or, for `capBreachAfterCell`, actual) USD figure per cell already accounted for. */
  cellEstimatesUsd: number[];
}

export interface CapCheckResult {
  ok: boolean;
  violations: CapViolation[];
  runTotalUsd: number;
  monthTotalAfterUsd: number;
}

/** SPEC §8 `plan`-time check: every individual cell against `maxCellUsd`, the run's total against `maxRunUsd`, and the run added to committed month-to-date against `maxMonthUsd`. Pure — never throws; see `assertWithinCaps`. */
export function checkCaps(input: CapCheckInput): CapCheckResult {
  const { caps, monthToDateUsd, cellEstimatesUsd } = input;
  const violations: CapViolation[] = [];
  cellEstimatesUsd.forEach((usd, cellIndex) => {
    if (usd > caps.maxCellUsd) violations.push({ kind: "cell", limitUsd: caps.maxCellUsd, wouldBeUsd: usd, cellIndex });
  });
  const runTotalUsd = cellEstimatesUsd.reduce((sum, usd) => sum + usd, 0);
  if (runTotalUsd > caps.maxRunUsd) violations.push({ kind: "run", limitUsd: caps.maxRunUsd, wouldBeUsd: runTotalUsd });
  const monthTotalAfterUsd = monthToDateUsd + runTotalUsd;
  if (monthTotalAfterUsd > caps.maxMonthUsd) {
    violations.push({ kind: "month", limitUsd: caps.maxMonthUsd, wouldBeUsd: monthTotalAfterUsd });
  }
  return { ok: violations.length === 0, violations, runTotalUsd, monthTotalAfterUsd };
}

function formatViolation(v: CapViolation): string {
  const cellNote = v.kind === "cell" && v.cellIndex !== undefined ? ` (cell #${String(v.cellIndex)})` : "";
  return `${v.kind}${cellNote}: $${v.wouldBeUsd.toFixed(4)} exceeds cap $${v.limitUsd.toFixed(2)}`;
}

/** SPEC §8: "`plan` refuses to emit a plan that exceeds any cap." Throws `E_CAP` naming every violation; a clean result is a no-op. */
export function assertWithinCaps(result: CapCheckResult): void {
  if (result.ok) return;
  throw new TiltmeterError("E_CAP", `plan exceeds cap(s):\n${result.violations.map(formatViolation).join("\n")}`);
}

export interface CapGate {
  caps: Caps;
  /** Committed month-to-date, from BEFORE this run started. */
  monthToDateUsd: number;
  /** This run's ACTUAL spend so far, summed from completed cells' `cost.actualUsd` — not estimates. */
  runSoFarUsd: number;
}

/**
 * SPEC §8 `run`-time re-check: "re-checks against ACTUAL usage after each
 * cell." Call with the cell that JUST completed's actual cost; a defined
 * return value means the run must stop submitting further cells (the
 * caller writes that next cell's reading as `aborted`, `abortedBy: "cap"` —
 * see `buildNeverAttemptedAbortedReading` in `core/run.ts`). `undefined`
 * means proceed.
 */
export function capBreachAfterCell(gate: CapGate, cellActualUsd: number): CapViolation | undefined {
  if (cellActualUsd > gate.caps.maxCellUsd) {
    return { kind: "cell", limitUsd: gate.caps.maxCellUsd, wouldBeUsd: cellActualUsd };
  }
  const newRunTotal = gate.runSoFarUsd + cellActualUsd;
  if (newRunTotal > gate.caps.maxRunUsd) {
    return { kind: "run", limitUsd: gate.caps.maxRunUsd, wouldBeUsd: newRunTotal };
  }
  const newMonthTotal = gate.monthToDateUsd + newRunTotal;
  if (newMonthTotal > gate.caps.maxMonthUsd) {
    return { kind: "month", limitUsd: gate.caps.maxMonthUsd, wouldBeUsd: newMonthTotal };
  }
  return undefined;
}

/** `readings/index.json` is the committed, append-only ledger (SPEC §3.3/§8) — month-to-date is summed from it directly, never estimated. `month` is `"YYYY-MM"`; an entry's `at` is compared by string prefix (both are ISO-8601, so this is exact). */
export function monthToDateUsd(indexChain: readonly { at: string; costUsd: number }[], month: string): number {
  return indexChain.filter((entry) => entry.at.startsWith(month)).reduce((sum, entry) => sum + entry.costUsd, 0);
}
