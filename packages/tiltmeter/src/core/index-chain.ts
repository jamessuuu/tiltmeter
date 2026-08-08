/**
 * `readings/index.json` — the append-only, hash-chained ledger (SPEC §3.3):
 * "each entry `{runGroupId, at, harnessCommit, runnerBehaviorVersion,
 * cells[], status, costUsd, hash, prevHash}`… Canonical JSON everywhere."
 * Pure and isomorphic (SPEC §6) — reading the file off disk is `src/cli`'s
 * job (`tiltmeter verify`); this module only knows how to hash, append to,
 * and verify an in-memory chain.
 */
import { z } from "zod";
import { canonicalStringify, jcsCanonical } from "./canonical.js";
import { sha256Hex } from "./sha256.js";
import { ReadingStatusSchema } from "./reading.js";

export const IndexEntryCellSchema = z.object({
  suiteId: z.string().min(1),
  cellId: z.string().min(1),
  bodyHash: z.string().min(1),
});
export type IndexEntryCell = z.infer<typeof IndexEntryCellSchema>;

export const IndexEntrySchema = z.object({
  runGroupId: z.string().min(1),
  at: z.string().min(1),
  harnessCommit: z.string().min(1),
  runnerBehaviorVersion: z.number().int().nonnegative(),
  cells: z.array(IndexEntryCellSchema),
  /** SPEC §8's 60-day mitigation: a "skipped" entry (no key / cap already spent) is still a commit — the chain never silently stops. */
  status: ReadingStatusSchema,
  costUsd: z.number().nonnegative(),
  /** SPEC §8/§9: the human-readable reason behind a `skipped` or `aborted` entry ("no key", "cap reached", …) — never omitted for those two statuses, so the mitigation commit is legible on its own. Optional so a `complete` entry (M2's shape) is unaffected. */
  reason: z.string().optional(),
  hash: z.string().min(1),
  /** `null` only for the chain's first entry. */
  prevHash: z.string().nullable(),
});
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

export type IndexEntryFields = Omit<IndexEntry, "hash">;

/** sha256 of the canonicalized entry with `hash` itself excluded — the same shape as `bodyHash` and `suiteSpecHash`. */
export function computeEntryHash(entry: IndexEntryFields): string {
  return `sha256:${sha256Hex(jcsCanonical(entry))}`;
}

/**
 * Append one entry to a chain (pure — returns a new array; `chain` is never
 * mutated). `prevHash` is derived from the chain's current tail, so callers
 * never set it themselves — that is the one thing that makes the chain
 * tamper-evident rather than just a list of self-consistent hashes.
 */
export function appendEntry(
  chain: readonly IndexEntry[],
  fields: Omit<IndexEntryFields, "prevHash">,
): IndexEntry {
  const tail = chain[chain.length - 1];
  const prevHash = tail === undefined ? null : tail.hash;
  const withoutHash: IndexEntryFields = { ...fields, prevHash };
  return { ...withoutHash, hash: computeEntryHash(withoutHash) };
}

export interface ChainVerifyResult {
  ok: boolean;
  brokenAtIndex?: number;
  reason?: string;
}

/**
 * Walk the whole chain: every entry's `hash` must recompute correctly from
 * its own fields, and every entry's `prevHash` must equal the PRECEDING
 * entry's `hash` (or `null` for the first entry). One mismatch anywhere
 * breaks the whole chain from that point forward — the tamper-evidence
 * SPEC §3.3 describes ("git history on a public repo plus the hash chain"
 * is the load-bearing proof, no signing key).
 */
export function verifyChain(chain: readonly IndexEntry[]): ChainVerifyResult {
  let expectedPrevHash: string | null = null;
  for (const [i, entry] of chain.entries()) {
    if (entry.prevHash !== expectedPrevHash) {
      return { ok: false, brokenAtIndex: i, reason: "prevHash does not match the preceding entry's hash" };
    }
    const { hash, ...rest } = entry;
    const recomputed = computeEntryHash(rest);
    if (recomputed !== hash) {
      return { ok: false, brokenAtIndex: i, reason: "entry hash does not match its own canonicalized fields" };
    }
    expectedPrevHash = hash;
  }
  return { ok: true };
}

/** Canonical on-disk form of `readings/index.json` (SPEC §3.3: "keys sorted, 2-space, LF, trailing newline"). */
export function serializeIndex(chain: readonly IndexEntry[]): string {
  return canonicalStringify(chain);
}

export function parseIndex(data: unknown): IndexEntry[] {
  return z.array(IndexEntrySchema).parse(data);
}
