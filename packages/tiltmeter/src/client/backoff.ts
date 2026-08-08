/**
 * Full-jitter backoff (SPEC §9: "429 / 529 / transient 5xx → full-jitter
 * backoff, ≤3 attempts, `Retry-After` honoured; then the trial is
 * `noResult` — never scored as a fail"). Lives in `src/client` (not
 * `core`): this is the one place the codebase is allowed to use
 * `Math.random`/a real sleep — the eslint boundary rule (SPEC §6) only
 * bans ambient randomness/clock in `core`/`testing`, since those must stay
 * deterministic; the client is inherently talking to a non-deterministic
 * network and is exempt for exactly that reason.
 *
 * Full-jitter formula (the AWS architecture-blog formulation): `sleep =
 * random(0, min(cap, base * 2^attempt))` — every parameter is injectable so
 * `anthropic.test.ts` can run the whole retry ladder with a fake sleep (no
 * real waiting) and a fixed random sequence (deterministic assertions),
 * which is what keeps this file's own tests at $0 and instant despite
 * exercising real backoff math.
 */

export const MAX_ATTEMPTS = 3;
const DEFAULT_BASE_MS = 500;
const DEFAULT_CAP_MS = 8_000;

export interface BackoffDeps {
  /** Defaults to `Math.random` — injected so tests are deterministic. */
  random?: () => number;
  /** Defaults to a real `setTimeout`-based sleep — injected so tests never actually wait. */
  sleep?: (ms: number) => Promise<void>;
  baseMs?: number;
  capMs?: number;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One full-jitter delay for a given (1-based) attempt number, honoring a `Retry-After` value in seconds when the provider supplied one (SPEC §9: "Retry-After honoured" takes priority over the computed jitter). */
export function fullJitterDelayMs(attempt: number, retryAfterSeconds: number | undefined, deps: BackoffDeps = {}): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.ceil(retryAfterSeconds * 1000);
  }
  const random = deps.random ?? Math.random;
  const baseMs = deps.baseMs ?? DEFAULT_BASE_MS;
  const capMs = deps.capMs ?? DEFAULT_CAP_MS;
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(random() * exp);
}

/** Parse an HTTP `Retry-After` header — either a plain integer number of seconds (the common case for 429/529 responses) or an HTTP-date; `undefined` if absent/unparseable, which just means "no explicit provider guidance, use computed jitter". */
export function parseRetryAfterSeconds(headerValue: string | null): number | undefined {
  if (headerValue === null) return undefined;
  const asNumber = Number(headerValue);
  if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber;
  const asDate = Date.parse(headerValue);
  if (Number.isNaN(asDate)) return undefined;
  const deltaSeconds = (asDate - Date.now()) / 1000;
  return deltaSeconds > 0 ? deltaSeconds : 0;
}

/** Return `{ ok: true, value }` on success. Return `{ ok: false, retryable, retryAfterSeconds? }` on a failure this call site can classify — `retryable: false` stops immediately without spending remaining attempts. */
export type RetryableAttempt<T> = (
  attempt: number,
) => Promise<{ ok: true; value: T } | { ok: false; retryable: boolean; retryAfterSeconds?: number; reason: string }>;

/**
 * Run `op` up to `MAX_ATTEMPTS` TOTAL tries (SPEC §9: "≤3 attempts"),
 * sleeping a full-jitter delay between retryable failures. Returns the
 * success value, or the last failure's reason string if every attempt was
 * exhausted (or a non-retryable failure was returned) — the caller
 * (`src/client/anthropic.ts`) turns that into a `noResult` trial, never a
 * thrown exception (SPEC §9: "never scored as a fail").
 */
export async function withFullJitterRetry<T>(
  op: RetryableAttempt<T>,
  deps: BackoffDeps = {},
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  const sleep = deps.sleep ?? realSleep;
  let lastReason = "unknown failure";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await op(attempt);
    if (result.ok) return result;
    lastReason = result.reason;
    if (!result.retryable || attempt === MAX_ATTEMPTS) break;
    await sleep(fullJitterDelayMs(attempt, result.retryAfterSeconds, deps));
  }
  return { ok: false, reason: lastReason };
}
