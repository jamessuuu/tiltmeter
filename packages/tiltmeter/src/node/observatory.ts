/**
 * `observatory/**` file I/O (SPEC §2/§6: "src/node — fs, git introspection,
 * config loader"). This is the ONE place besides `src/cli/verify.ts` that
 * touches `node:fs` directly for observatory data — `src/cli/commands/*`
 * calls into this rather than reading files itself, so the CLI commands
 * stay thin wiring and every file-shape decision (where a `plan.json` or
 * `run.json` lives) is made exactly once.
 *
 * Layout (SPEC §2, this module's own addition in parens):
 *   observatory/suites/<id>.suite.json
 *   observatory/presentations/<id>.json
 *   observatory/panel.json
 *   observatory/pricing/<manifestId>.json
 *   observatory/readings/<runGroupId>/plan.json        (this module's choice — see readPlan below)
 *   observatory/readings/<runGroupId>/run.json
 *   observatory/readings/<runGroupId>/<suiteId>__<cellId>.json
 *   observatory/readings/index.json
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalStringify } from "../core/canonical.js";
import { parseSuite, suiteSpecHash, type Suite } from "../core/suite.js";
import { parsePresentation, type Presentation } from "../core/presentation.js";
import { parsePanel, parsePlan, type Panel, type Plan } from "../core/plan.js";
import { parsePricingManifest, type PricingManifest } from "../core/pricing.js";
import { parseReading, type Reading } from "../core/reading.js";
import { parseRunRecord, type RunRecord } from "../core/batch.js";
import { parseIndex, type IndexEntry } from "../core/index-chain.js";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonCanonical(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, canonicalStringify(value));
}

export function suitesDir(observatoryDir: string): string {
  return join(observatoryDir, "suites");
}

export function readSuite(observatoryDir: string, id: string): Suite {
  return parseSuite(readJson(join(suitesDir(observatoryDir), `${id}.suite.json`)));
}

export function suiteExists(observatoryDir: string, id: string): boolean {
  return existsSync(join(suitesDir(observatoryDir), `${id}.suite.json`));
}

/** M8 `tiltmeter init`: write a NEW suite file. Callers check `suiteExists` first and refuse rather than overwrite (SPEC §3.1 Decision 2: items are immutable — silently replacing a whole suite file is the same class of mistake writ large). */
export function writeSuite(observatoryDir: string, suite: Suite): void {
  writeJsonCanonical(join(suitesDir(observatoryDir), `${suite.id}.suite.json`), suite);
}

/** Every suite file in `observatory/suites/` — order is filesystem order (`readdirSync`'s own, stable on a given OS/filesystem but not guaranteed cross-platform; callers that need a stable order sort by `.id` themselves). */
export function readAllSuites(observatoryDir: string): Suite[] {
  const dir = suitesDir(observatoryDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".suite.json"))
    .map((f) => parseSuite(readJson(join(dir, f))));
}

export function readPresentation(observatoryDir: string, id: string): Presentation {
  return parsePresentation(readJson(join(observatoryDir, "presentations", `${id}.json`)));
}

/** M8 `tiltmeter init`: write a presentation template ONLY if `presentations/<id>.json` does not already exist — never clobber a project's own customized template. Returns whether it wrote. */
export function writePresentationIfMissing(observatoryDir: string, presentation: Presentation): boolean {
  const path = join(observatoryDir, "presentations", `${presentation.id}.json`);
  if (existsSync(path)) return false;
  writeJsonCanonical(path, presentation);
  return true;
}

export function readPanel(observatoryDir: string): Panel {
  return parsePanel(readJson(join(observatoryDir, "panel.json")));
}

/** M8 `tiltmeter init`: write `panel.json` ONLY if it does not already exist — never clobber a real panel with the scaffold default. Returns whether it wrote. */
export function writePanelIfMissing(observatoryDir: string, panel: Panel): boolean {
  const path = join(observatoryDir, "panel.json");
  if (existsSync(path)) return false;
  writeJsonCanonical(path, panel);
  return true;
}

/** `manifestId` e.g. `"pricing.2026-08-08"` -> `observatory/pricing/pricing.2026-08-08.json`. Omit to read whichever single manifest file is present (the common case — one dated manifest at a time; a repo with more than one is a caller error, reported clearly rather than silently picking one). */
export function readPricingManifest(observatoryDir: string, manifestId?: string): PricingManifest {
  const dir = join(observatoryDir, "pricing");
  if (manifestId !== undefined) return parsePricingManifest(readJson(join(dir, `${manifestId}.json`)));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  if (files.length === 0) throw new Error(`observatory/pricing: no pricing manifest found in ${dir}`);
  if (files.length > 1) {
    throw new Error(`observatory/pricing: multiple manifests found (${files.join(", ")}) — pass manifestId explicitly`);
  }
  const [only] = files;
  if (only === undefined) throw new Error("unreachable"); // guarded by the length checks above
  return parsePricingManifest(readJson(join(dir, only)));
}

/** True when `pricing/` already has ANY manifest file — `readPricingManifest`'s own contract requires exactly one to be present with no id given, so `tiltmeter init` must never write a second one alongside a project's real manifest. */
export function hasAnyPricingManifest(observatoryDir: string): boolean {
  const dir = join(observatoryDir, "pricing");
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".json"));
}

/** M8 `tiltmeter init`: write a bundled pricing manifest ONLY when `pricing/` has no manifest at all yet (see `hasAnyPricingManifest`). Returns whether it wrote. */
export function writePricingManifestIfMissing(observatoryDir: string, manifest: PricingManifest): boolean {
  if (hasAnyPricingManifest(observatoryDir)) return false;
  writeJsonCanonical(join(observatoryDir, "pricing", `${manifest.id}.json`), manifest);
  return true;
}

function runGroupDir(observatoryDir: string, runGroupId: string): string {
  return join(observatoryDir, "readings", runGroupId);
}

/**
 * Where `plan.json` lives — this module's own design decision, not
 * literally specified by SPEC §2's file tree: alongside a run group's
 * `run.json` and reading files, since a plan is scoped to exactly one run
 * group and `run --resume <rg>` needs to find both in the same place.
 */
export function planPath(observatoryDir: string, runGroupId: string): string {
  return join(runGroupDir(observatoryDir, runGroupId), "plan.json");
}

export function writePlanFile(observatoryDir: string, plan: Plan): void {
  writeJsonCanonical(planPath(observatoryDir, plan.runGroupId), plan);
}

export function readPlanFile(observatoryDir: string, runGroupId: string): Plan | undefined {
  const path = planPath(observatoryDir, runGroupId);
  if (!existsSync(path)) return undefined;
  return parsePlan(readJson(path));
}

function runRecordPath(observatoryDir: string, runGroupId: string): string {
  return join(runGroupDir(observatoryDir, runGroupId), "run.json");
}

export function readRunRecord(observatoryDir: string, runGroupId: string): RunRecord | undefined {
  const path = runRecordPath(observatoryDir, runGroupId);
  if (!existsSync(path)) return undefined;
  return parseRunRecord(readJson(path));
}

export function writeRunRecord(observatoryDir: string, record: RunRecord): void {
  writeJsonCanonical(runRecordPath(observatoryDir, record.runGroupId), record);
}

function readingPath(observatoryDir: string, runGroupId: string, suiteId: string, cellId: string): string {
  return join(runGroupDir(observatoryDir, runGroupId), `${suiteId}__${cellId}.json`);
}

export function readReadingFile(observatoryDir: string, runGroupId: string, suiteId: string, cellId: string): Reading | undefined {
  const path = readingPath(observatoryDir, runGroupId, suiteId, cellId);
  if (!existsSync(path)) return undefined;
  return parseReading(readJson(path));
}

export function writeReadingFile(observatoryDir: string, reading: Reading): void {
  writeJsonCanonical(readingPath(observatoryDir, reading.runGroupId, reading.suiteId, reading.cellId), reading);
}

export function readIndexChain(observatoryDir: string): IndexEntry[] {
  const path = join(observatoryDir, "readings", "index.json");
  if (!existsSync(path)) return [];
  return parseIndex(readJson(path));
}

export function writeIndexChain(observatoryDir: string, chain: readonly IndexEntry[]): void {
  writeJsonCanonical(join(observatoryDir, "readings", "index.json"), chain);
}

/** Current `suiteSpecHash` per suite id, for `assertPlanFresh` (SPEC §9 E_PLAN_STALE) — reads every suite file fresh off disk rather than trusting anything cached. */
export function currentSuiteSpecHashes(observatoryDir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const suite of readAllSuites(observatoryDir)) {
    out.set(suite.id, suiteSpecHash(suite));
  }
  return out;
}
