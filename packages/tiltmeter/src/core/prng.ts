/**
 * Deterministic in-repo PRNG (SPEC §5: "seeded paired percentile bootstrap
 * … seed = first 8 hex of sha256(bodyHashA+bodyHashB) — deterministic,
 * reproducible, and not chosen by the analyst"; SPEC §13/eslint boundary:
 * "no Math.random — the PRNG is seeded and in-repo").
 *
 * mulberry32: small, fast, passes practical randomness tests, and is the
 * same generator family used by the sibling repo's fault-plan seeding
 * (sluice's FaultPlan). A 32-bit unsigned integer seed produces the same
 * stream on every platform — no reliance on engine-specific Math.random
 * behavior.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Interpret the first 8 hex chars of a hash as an unsigned 32-bit seed. */
export function seedFromHex8(hashHex: string): number {
  const slice = hashHex.slice(0, 8);
  const parsed = Number.parseInt(slice, 16);
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`seedFromHex8: not a hex string: ${hashHex}`);
  }
  return parsed >>> 0;
}

/**
 * Fisher–Yates shuffle-in-place using an injected Rng. Used for resampling.
 * Bounds are structurally guaranteed (`0 <= j <= i < arr.length` by the
 * loop invariant) — the non-null assertions here are the same class of
 * exception eslint.config.mjs already grants `core/sha256.ts`.
 */
export function shuffleInPlace<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Draw an integer index in [0, length). */
export function randomIndex(rng: Rng, length: number): number {
  return Math.floor(rng() * length);
}
