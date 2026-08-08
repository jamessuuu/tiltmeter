/**
 * `tiltmeter verify` (SPEC §7): "For each reading it (1) recomputes
 * `suiteSpecHash`… (2) walks git history… (3) reads `models.json`… (4)
 * asserts `suiteRegisteredAt < modelReleasedAt`." This module is pure
 * (SPEC §6): no git, no fs. The git walk itself (finding WHICH commit
 * first introduced a given `suiteSpecHash`) is necessarily I/O and lives
 * in `src/node/git.ts`; this file owns only the DECISION — given a
 * resolved commit date and a model's cited release date, is the
 * pre-registration claim true — so that decision is unit-testable without
 * ever shelling out to git.
 */
import { canonicalStringify, jcsCanonical } from "./canonical.js";
import { sha256Hex } from "./sha256.js";
import type { Reading } from "./reading.js";
import { verifyChain, type ChainVerifyResult, type IndexEntry } from "./index-chain.js";

/** Canonical on-disk bytes for one reading (SPEC §3.3: canonical JSON everywhere). */
export function readingBytes(reading: Reading): string {
  return canonicalStringify(reading);
}

/** Recompute `bodyHash` from every field except `bodyHash` itself and compare (SPEC §3.3, same shape as `suiteSpecHash`'s `docs` exclusion). */
export function verifyReadingBodyHash(reading: Reading): boolean {
  const { bodyHash, ...rest } = reading;
  return `sha256:${sha256Hex(jcsCanonical(rest))}` === bodyHash;
}

export interface ReadingVerifyResult {
  runGroupId: string;
  suiteId: string;
  cellId: string;
  ok: boolean;
}

export interface CorpusVerifyResult {
  ok: boolean;
  readings: ReadingVerifyResult[];
  chain: ChainVerifyResult;
}

/** Verify every reading's body hash plus the index chain as one corpus-level result. */
export function verifyCorpus(readings: readonly Reading[], indexChain: readonly IndexEntry[]): CorpusVerifyResult {
  const readingResults = readings.map((r) => ({
    runGroupId: r.runGroupId,
    suiteId: r.suiteId,
    cellId: r.cellId,
    ok: verifyReadingBodyHash(r),
  }));
  const chain = verifyChain(indexChain);
  return { ok: chain.ok && readingResults.every((r) => r.ok), readings: readingResults, chain };
}

/**
 * SPEC §7's pre-registration proof, the decision half: given a reading's
 * identity, the git commit that first introduced its `suiteSpecHash` (and
 * that commit's date — resolved by `src/node/git.ts`'s walk, NOT by this
 * function), and the requested model's cited `releasedAt`, decide whether
 * `suiteRegisteredAt < modelReleasedAt` (both plain `YYYY-MM-DD` or full
 * ISO-8601 — lexicographic comparison is exact for either, as long as both
 * inputs use the same precision). `ok: false` is a real, publishable
 * outcome (SPEC §12's "the director's edge case" sibling: a suite that
 * was NOT provably pre-registered before a given model existed), not an
 * error — the caller decides what to do with a failed claim.
 */
export interface PreRegistrationInput {
  suiteId: string;
  cellId: string;
  runGroupId: string;
  modelIdRequested: string;
  suiteSpecHash: string;
  /** The commit SHA that first introduced this exact `suiteSpecHash` (resolved by the git walk). `undefined` if no commit in history matches — the claim cannot be made at all. */
  registeredAtCommit: string | undefined;
  /** That commit's date (`YYYY-MM-DD` or full ISO-8601). `undefined` alongside `registeredAtCommit`. */
  suiteRegisteredAt: string | undefined;
  modelReleasedAt: string | undefined;
  modelSourceUrl: string | undefined;
}

export interface PreRegistrationResult extends PreRegistrationInput {
  /** `true` only when every input above resolved AND `suiteRegisteredAt < modelReleasedAt`. */
  ok: boolean;
  /** Why `ok` is false — absent when `ok` is true. */
  reason?: string;
}

export function evaluatePreRegistration(input: PreRegistrationInput): PreRegistrationResult {
  if (input.registeredAtCommit === undefined || input.suiteRegisteredAt === undefined) {
    return { ...input, ok: false, reason: "no commit in git history reproduces this suiteSpecHash" };
  }
  if (input.modelReleasedAt === undefined || input.modelSourceUrl === undefined) {
    return { ...input, ok: false, reason: `models.json has no entry for "${input.modelIdRequested}"` };
  }
  if (!(input.suiteRegisteredAt < input.modelReleasedAt)) {
    return { ...input, ok: false, reason: `suite registered ${input.suiteRegisteredAt} is not before model released ${input.modelReleasedAt}` };
  }
  return { ...input, ok: true };
}
