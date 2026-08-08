/**
 * `tiltmeter verify` (SPEC §7): "For each reading it (1) recomputes
 * `suiteSpecHash`… (2) walks git history… (3) reads `models.json`… (4)
 * asserts `suiteRegisteredAt < modelReleasedAt`." SPEC §14 M2's gate scopes
 * this milestone to the two pieces checkable from committed JSON alone —
 * body hashes and the index hash chain — and explicitly defers the git
 * pre-registration walk to M5 ("stub it with explicit not-yet-implemented
 * output, NEVER a false pass"). This module is pure (SPEC §6): no git, no
 * fs — `src/cli/verify.ts` reads `observatory/readings/**` off disk and
 * calls into this.
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
 * SPEC §7's pre-registration proof — recompute `suiteSpecHash`, walk git
 * history for the first commit whose tree contains it, read the model's
 * cited `releasedAt`, and assert `suiteRegisteredAt < modelReleasedAt` — is
 * an M5 deliverable (it needs a real observatory + `models.json` + a git
 * walk, none of which exist yet). This function's return type has no `ok`
 * field at all — there is no value it could return that a caller could
 * mistake for a pass. Never call this expecting an answer; it exists so
 * `tiltmeter verify`'s output always names the gap instead of silently
 * omitting it.
 */
export interface GitPreRegistrationNotImplemented {
  implemented: false;
  reason: string;
}

export function verifyGitPreRegistration(): GitPreRegistrationNotImplemented {
  return {
    implemented: false,
    reason:
      "the git pre-registration walk (SPEC §7: suiteSpecHash -> git history -> models.json releasedAt -> " +
      "suiteRegisteredAt < modelReleasedAt) lands at M5 with the real observatory. Not yet implemented — " +
      "this is a stub, never a pass.",
  };
}
