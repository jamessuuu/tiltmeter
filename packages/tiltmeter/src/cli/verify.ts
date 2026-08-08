/**
 * `tiltmeter verify` (SPEC §7, §14 M2/M5): reads `observatory/readings/**`
 * off disk, checks every reading's body hash and the `readings/index.json`
 * hash chain (`core/verify.ts` / `core/index-chain.ts`), and — M5, replacing
 * the M2 stub — walks git history per reading to complete SPEC §7's
 * pre-registration proof: recompute `suiteSpecHash`, find the first commit
 * that produced it, read `models.json`'s cited `releasedAt` for the
 * requested model, and assert `suiteRegisteredAt < modelReleasedAt`,
 * printing the commit SHA and both dates. On an empty corpus (true today —
 * M5 ships zero readings, see `observatory/readings/README.md`) there is
 * nothing to walk, and that is reported plainly rather than faked.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseIndex, type IndexEntry } from "../core/index-chain.js";
import { parseReading, type Reading } from "../core/reading.js";
import { parseSuite, suiteSpecHash } from "../core/suite.js";
import { findModelEntry, parseModels, type Models } from "../core/models.js";
import { evaluatePreRegistration, verifyCorpus, type CorpusVerifyResult, type PreRegistrationResult } from "../core/verify.js";
import { findFirstCommitWithHash } from "../node/git.js";
import type { CliIo } from "./run.js";

export interface ReadCorpusResult {
  readings: Reading[];
  indexChain: IndexEntry[];
  errors: string[];
}

/** SPEC §2 layout: `readings/index.json` + `readings/<runGroupId>/<suiteId>__<cellId>.json` (and a `run.json`/`plan.json` per run group, skipped here — submission bookkeeping, not a reading). */
export function readReadingsCorpus(observatoryDir: string): ReadCorpusResult {
  const readingsDir = join(observatoryDir, "readings");
  const errors: string[] = [];
  if (!existsSync(readingsDir)) {
    return { readings: [], indexChain: [], errors };
  }

  let indexChain: IndexEntry[] = [];
  const indexPath = join(readingsDir, "index.json");
  if (existsSync(indexPath)) {
    try {
      indexChain = parseIndex(JSON.parse(readFileSync(indexPath, "utf8")));
    } catch (error) {
      errors.push(`readings/index.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const readings: Reading[] = [];
  for (const entry of readdirSync(readingsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runGroupDir = join(readingsDir, entry.name);
    for (const file of readdirSync(runGroupDir)) {
      if (!file.endsWith(".json") || file === "run.json" || file === "plan.json") continue;
      const relPath = `readings/${entry.name}/${file}`;
      try {
        readings.push(parseReading(JSON.parse(readFileSync(join(runGroupDir, file), "utf8"))));
      } catch (error) {
        errors.push(`${relPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { readings, indexChain, errors };
}

/**
 * SPEC §7's git walk for ONE reading — resolves its suite file's path
 * relative to `repoRoot` (git paths are repo-root-relative) and asks
 * `src/node/git.ts` when its exact `suiteSpecHash` first landed.
 * `observatoryRelPrefix` is the `observatory/` directory's path AS SEEN
 * FROM `repoRoot` (normally `"observatory/"`; a test fixture whose git
 * repo root is not the CLI's `cwd` passes something else).
 */
function resolvePreRegistration(
  repoRoot: string,
  observatoryRelPrefix: string,
  reading: Reading,
  models: Models | undefined,
): PreRegistrationResult {
  const suiteRelPath = `${observatoryRelPrefix}suites/${reading.suiteId}.suite.json`;
  const found = findFirstCommitWithHash(repoRoot, suiteRelPath, reading.axes.suiteSpecHash, (content) =>
    suiteSpecHash(parseSuite(JSON.parse(content))),
  );
  const modelEntry = models === undefined ? undefined : findModelEntry(models, reading.axes.modelIdRequested);
  return evaluatePreRegistration({
    suiteId: reading.suiteId,
    cellId: reading.cellId,
    runGroupId: reading.runGroupId,
    modelIdRequested: reading.axes.modelIdRequested,
    suiteSpecHash: reading.axes.suiteSpecHash,
    registeredAtCommit: found?.commit,
    suiteRegisteredAt: found?.date,
    modelReleasedAt: modelEntry?.releasedAt,
    modelSourceUrl: modelEntry?.sourceUrl,
  });
}

export interface VerifyOutcome {
  ok: boolean;
  emptyCorpus: boolean;
  corpus: CorpusVerifyResult;
  parseErrors: string[];
  preRegistration: PreRegistrationResult[];
}

export function runVerify(cwd: string, io: CliIo): VerifyOutcome {
  const observatoryDir = join(cwd, "observatory");
  const { readings, indexChain, errors } = readReadingsCorpus(observatoryDir);
  const emptyCorpus = readings.length === 0 && indexChain.length === 0;
  const corpus = verifyCorpus(readings, indexChain);

  if (emptyCorpus && errors.length === 0) {
    io.stdout(
      "tiltmeter verify: no readings corpus found at observatory/readings/ — nothing to verify yet " +
        "(the observatory's first real run group is James-gated; see observatory/readings/README.md).",
    );
  } else {
    const entryWord = indexChain.length === 1 ? "entry" : "entries";
    io.stdout(`tiltmeter verify: ${String(readings.length)} reading(s), ${String(indexChain.length)} index ${entryWord}`);
    for (const r of corpus.readings) {
      io.stdout(`  ${r.ok ? "OK  " : "FAIL"} body hash — ${r.runGroupId}/${r.suiteId}__${r.cellId}`);
    }
    const chainNote = corpus.chain.ok
      ? ""
      : ` — broken at entry ${String(corpus.chain.brokenAtIndex ?? -1)}: ${corpus.chain.reason ?? "unknown"}`;
    io.stdout(`  ${corpus.chain.ok ? "OK  " : "FAIL"} index hash chain${chainNote}`);
    for (const e of errors) io.stderr(`  FAIL parse — ${e}`);
  }

  let models: Models | undefined;
  const modelsPath = join(observatoryDir, "models.json");
  if (existsSync(modelsPath)) {
    try {
      models = parseModels(JSON.parse(readFileSync(modelsPath, "utf8")));
    } catch (error) {
      io.stderr(`  FAIL parse — observatory/models.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const preRegistration: PreRegistrationResult[] = [];
  if (readings.length === 0) {
    io.stdout(
      "tiltmeter verify: git pre-registration walk — no readings to check yet " +
        "(SPEC §7's proof runs per reading; there is nothing to prove until a reading exists).",
    );
  } else {
    io.stdout("tiltmeter verify: git pre-registration walk —");
    for (const reading of readings) {
      const result = resolvePreRegistration(cwd, "observatory/", reading, models);
      preRegistration.push(result);
      const label = `${result.runGroupId}/${result.suiteId}__${result.cellId} (${result.modelIdRequested})`;
      if (result.ok) {
        io.stdout(
          `  OK   ${label} — registered ${result.suiteRegisteredAt ?? "?"} (commit ${(result.registeredAtCommit ?? "").slice(0, 12)}) ` +
            `< released ${result.modelReleasedAt ?? "?"}`,
        );
      } else {
        io.stderr(`  FAIL ${label} — ${result.reason ?? "pre-registration could not be established"}`);
      }
    }
  }

  const preRegOk = preRegistration.every((r) => r.ok);
  return {
    ok: corpus.ok && errors.length === 0 && preRegOk,
    emptyCorpus,
    corpus,
    parseErrors: errors,
    preRegistration,
  };
}
