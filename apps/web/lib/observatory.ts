/**
 * Build-time data loading (SPEC §6/§13: "apps/web imports core/compare +
 * core/stats and reads committed JSON at build time; it has no runtime
 * dependency on the client and no API routes at all" / "Zod at every
 * boundary… site build inputs"). Every function here runs ONLY during
 * `next build` (Server Components + `generateStaticParams`, all
 * synchronous Node `fs` reads) — with `output: "export"` there is no
 * runtime server for any of this to run in later. Every file is parsed
 * through `tiltmeter`'s own Zod schemas — the SAME ones the CLI uses — so
 * a malformed committed file fails the BUILD, never renders silently
 * wrong.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseSuite,
  parsePresentation,
  parsePanel,
  parseModels,
  parsePricingManifest,
  parseReading,
  parseIndex,
  activeItems,
  suiteSpecHash,
  compareReadings,
  type Suite,
  type Presentation,
  type Panel,
  type Models,
  type PricingManifest,
  type Reading,
  type IndexEntry,
  type Comparison,
} from "tiltmeter";

// apps/web/lib -> repo root is two levels up, then observatory/.
const OBSERVATORY_DIR = join(process.cwd(), "..", "..", "observatory");

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(join(OBSERVATORY_DIR, relPath), "utf8"));
}

export function listSuiteIds(): string[] {
  const dir = join(OBSERVATORY_DIR, "suites");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".suite.json"))
    .map((f) => f.replace(/\.suite\.json$/, ""))
    .sort();
}

export function loadSuite(id: string): Suite {
  return parseSuite(readJson(`suites/${id}.suite.json`));
}

export function loadAllSuites(): Suite[] {
  return listSuiteIds().map((id) => loadSuite(id));
}

export function loadPresentation(id: string): Presentation {
  return parsePresentation(readJson(`presentations/${id}.json`));
}

export function loadPanel(): Panel {
  return parsePanel(readJson("panel.json"));
}

export function loadModels(): Models {
  return parseModels(readJson("models.json"));
}

export function loadPricingManifest(): PricingManifest {
  const dir = join(OBSERVATORY_DIR, "pricing");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const [only] = files;
  if (only === undefined) throw new Error("observatory/pricing: no pricing manifest found");
  return parsePricingManifest(readJson(`pricing/${only}`));
}

/** A committed JSON file under a run group directory that is an actual per-cell reading — excludes the run group's own metadata files (`run.json`, `plan.json`), which are written even for a `skipped`/`aborted` run group that landed zero real readings (SPEC §9: "API key missing/invalid… writes skipped with reason, commits"). */
function isReadingFile(fileName: string): boolean {
  return fileName.endsWith(".json") && fileName !== "run.json" && fileName !== "plan.json";
}

/**
 * Run group ids that have at least one real reading — a bare `readdirSync`
 * would also return a `skipped`/`aborted` run group's directory (it exists
 * and holds `plan.json`, sometimes `run.json`, but zero `<suiteId>__<cellId>.json`
 * files), which the readings route's placeholder logic treats as "a real run
 * group landed" and stops generating `/readings/none-yet` — a 404 for a
 * repo whose first-ever committed run group is an honest `skipped` record
 * (exactly what a fresh clone with no `ANTHROPIC_API_KEY` produces; verified
 * live against `rg-20260810-1`, this repo's actual first commit of that
 * shape). Mirrors `core/health.ts`'s `newestRealReadingAt`, which filters the
 * index chain by `cells.length > 0` for the same reason on the dead-man
 * banner's side — this is the readings-route side of that same rule.
 */
export function listRunGroupIds(): string[] {
  const dir = join(OBSERVATORY_DIR, "readings");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => readdirSync(join(dir, name)).some(isReadingFile))
    .sort();
}

export function loadIndexChain(): IndexEntry[] {
  const path = join(OBSERVATORY_DIR, "readings", "index.json");
  if (!existsSync(path)) return [];
  return parseIndex(JSON.parse(readFileSync(path, "utf8")));
}

export function loadReadingsForRunGroup(runGroupId: string): Reading[] {
  const dir = join(OBSERVATORY_DIR, "readings", runGroupId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isReadingFile)
    .map((f) => parseReading(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

export function loadAllReadings(): Reading[] {
  return listRunGroupIds().flatMap((rg) => loadReadingsForRunGroup(rg));
}

/** Total ACTIVE items across every committed suite — the launch-state copy's "N items" (SPEC §11), computed from real data, never hardcoded. */
export function totalActiveItemCount(): number {
  return loadAllSuites().reduce((sum, suite) => sum + activeItems(suite).length, 0);
}

export interface SuiteSeries {
  suite: Suite;
  currentSuiteSpecHash: string;
  /** Readings for this suite, oldest first, grouped by cellId — SPEC §10 "/": "per suite, a line per model across run groups." */
  byCellId: Map<string, Reading[]>;
}

/** All committed readings for one suite, organized into per-model (per-cellId) series, oldest-first — the shape `/`'s instrument renders one line from. */
export function buildSuiteSeries(suiteId: string): SuiteSeries {
  const suite = loadSuite(suiteId);
  const readings = loadAllReadings()
    .filter((r) => r.suiteId === suiteId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const byCellId = new Map<string, Reading[]>();
  for (const reading of readings) {
    const arr = byCellId.get(reading.cellId) ?? [];
    arr.push(reading);
    byCellId.set(reading.cellId, arr);
  }
  return { suite, currentSuiteSpecHash: suiteSpecHash(suite), byCellId };
}

/** Consecutive-pair model-axis comparisons within one cell's series (SPEC §4) — used to detect a rebaseline hard-break (`suiteSpecHash` differs between adjacent readings) and to compute the null-pair noise floor. */
export function consecutiveComparisons(readings: readonly Reading[]): Comparison[] {
  const out: Comparison[] = [];
  for (let i = 1; i < readings.length; i++) {
    out.push(compareReadings(readings[i - 1], readings[i]));
  }
  return out;
}

export { OBSERVATORY_DIR };
