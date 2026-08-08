/**
 * `tiltmeter verify` (SPEC §7, §14 M2): reads `observatory/readings/**` off
 * disk, checks every reading's body hash and the `readings/index.json` hash
 * chain (`core/verify.ts` / `core/index-chain.ts`), and always prints the
 * git pre-registration walk as not-yet-implemented (SPEC §7's proof; lands
 * at M5 with the real observatory) — never a silent omission, never a false
 * pass. This is the one file in `src/cli` allowed to touch `node:fs`
 * directly (SPEC §6: node builtins live in `src/node/**` and `src/cli/**`
 * only) — a dedicated `src/node` config-loader layer is M4/M5 scope; this
 * command's disk-reading needs are small enough not to wait for it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseIndex, type IndexEntry } from "../core/index-chain.js";
import { parseReading, type Reading } from "../core/reading.js";
import { verifyCorpus, verifyGitPreRegistration, type CorpusVerifyResult } from "../core/verify.js";
import type { CliIo } from "./run.js";

export interface ReadCorpusResult {
  readings: Reading[];
  indexChain: IndexEntry[];
  errors: string[];
}

/** SPEC §2 layout: `readings/index.json` + `readings/<runGroupId>/<suiteId>__<cellId>.json` (and a `run.json` per run group, skipped here — it is submission bookkeeping, not a reading). */
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
      if (!file.endsWith(".json") || file === "run.json") continue;
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

export interface VerifyOutcome {
  ok: boolean;
  emptyCorpus: boolean;
  corpus: CorpusVerifyResult;
  parseErrors: string[];
}

export function runVerify(cwd: string, io: CliIo): VerifyOutcome {
  const observatoryDir = join(cwd, "observatory");
  const { readings, indexChain, errors } = readReadingsCorpus(observatoryDir);
  const emptyCorpus = readings.length === 0 && indexChain.length === 0;
  const corpus = verifyCorpus(readings, indexChain);

  if (emptyCorpus && errors.length === 0) {
    io.stdout(
      "tiltmeter verify: no readings corpus found at observatory/readings/ — nothing to verify yet " +
        "(the observatory's first real run group lands at SPEC §14 M5).",
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

  const gitWalk = verifyGitPreRegistration();
  io.stdout(`tiltmeter verify: git pre-registration walk — NOT IMPLEMENTED (${gitWalk.reason})`);

  return { ok: corpus.ok && errors.length === 0, emptyCorpus, corpus, parseErrors: errors };
}
