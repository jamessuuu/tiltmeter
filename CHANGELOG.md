# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: semver.

## [Unreleased]

### Added
- M4 (real client — docs/SPEC.md §14/§7/§8/§9): `src/client/anthropic.ts`
  (`AnthropicModelClient`) implements the extended `ModelClient` interface
  (`core/model-client.ts` now carries `countTokens`/`submitBatch`/
  `pollBatch`/`fetchBatchResults` alongside `runTrial`, every method taking
  `modelIdRequested` as an explicit per-call parameter since one client
  instance serves every cell of a run group) — Messages API, the free
  `count_tokens` endpoint, the Message Batches API, and full-jitter backoff
  (`src/client/backoff.ts`: ≤3 attempts, `Retry-After` honoured, injectable
  random/sleep so tests never wait or touch a real socket). A 404 is
  detected and returned as `noResult` with `modelUnavailable: true`
  (never retried); every other non-2xx is classified retryable/not and
  never echoes the raw provider body (SECURITY.md). `FakeModelClient`
  (`src/testing`) now implements the full interface too — `countTokens` via
  a scriptable heuristic, batch ops as an in-memory simulation over the
  same per-(item,attempt) script, plus `scriptByCustomId` for batch-specific
  tests — so the whole M4 surface stays testable at $0 with zero network.

  New pure `core/` modules: `pricing.ts` (a dated, checked-in manifest —
  `observatory/pricing/pricing.2026-08-08.json` — with per-model dated rate
  rows; `selectPricingRow` picks the row whose `[effectiveFrom,
  effectiveTo)` window contains the request date, so the Sonnet 5 intro
  price change on 2026-08-31 selects the right row from data, never a
  hardcoded constant); `cost.ts` (the `--offline` chars/4 input-token
  heuristic, scaled by the manifest's per-model `estimateMultiplier` — 1.3x
  for Fable 5, the one SPEC §8 names); `caps.ts` (`DEFAULT_CAPS` =
  `{maxRunUsd:3, maxCellUsd:1.5, maxMonthUsd:15}`; `checkCaps`/
  `assertWithinCaps` for `plan`-time estimates, `capBreachAfterCell` for
  `run`-time re-checks against ACTUAL usage after each cell; `monthToDateUsd`
  sums the committed `readings/index.json`, never a guess); `batch.ts`
  (`batchCustomId = sha256(runGroup,suite,item,trial)`; `RunRecord`/
  `RunRecordCell` schemas; `submitCellBatch`'s `hasRecordedBatch` guard is
  the WHOLE duplicate-spend rule — a cell with a recorded `batchId` is
  returned unchanged, `client.submitBatch` is never called again;
  `collectCellBatchResults` + `retryCellBatch` implement the one-retry-of-
  the-failed-subset rule, tracked as its own generation counter
  (`retriedCustomIds`/`retryBatchId`) rather than overloading the existing
  per-trial `attempt` field — a recorded, deliberate deviation from a
  literal reading of SPEC §9's "recorded as attempt: 2"); `plan.ts`
  (`Panel`/`PlanCell`/`Plan` schemas, `hasNullPair`, `buildPlan` — exact
  `count_tokens`-driven estimates when a client is given, the offline
  heuristic when not, cap-checked via `assertWithinCaps` before ever
  returning a plan; `assertPlanFresh` throws `E_PLAN_STALE` when a suite's
  current hash no longer matches what `plan.json` pinned).

  `core/run.ts` is refactored (behavior-preserving for the sync path,
  verified by the unchanged M1-M3 `run.test.ts`): the trial-scoring/
  completeness/metrics/bodyHash logic is factored out as
  `buildReadingFromTrials`, shared by `runSuite` (sync) and the new batch
  path so both modes assemble a reading under IDENTICAL rules. New:
  `finalizeReading` (recompute `bodyHash`, used by every mutator below),
  `attachReadingCost` (adds SPEC §3.3's `cost` block after real usage/
  pricing is known), `buildNeverAttemptedAbortedReading` (SPEC §8's cap-
  abort path — every expected trial `noResult`, `status: "aborted"`,
  `abortedBy: "cap"`, never a silent skip). `Reading`'s schema gains
  `cost` (optional — every M1-M3 fixture stays valid), `abortedBy`, and a
  fifth `status` value `"unavailable"` (SPEC §9's 404/retired row — ANY
  trial flagged `modelUnavailable` forces the whole reading unavailable
  rather than partial; falls through `compare.ts`'s existing
  `status !== "complete" => cannot-attribute` gate unchanged).
  `readings/index.json` entries gain an optional `reason` field (for
  `skipped`/`aborted` entries).

  `core/run-orchestrator.ts`'s `executeRunGroup` ties it together: one pass
  over a run group's cells (sync via `runSuite`, batch via submit→collect→
  retry-once→build), attaching real cost after each cell, calling
  `capBreachAfterCell` against ACTUAL usage — a breach makes every
  SUBSEQUENT cell (not the one that tripped it, which already spent)
  become a never-attempted `aborted` reading, `runRecord.abortedBy: "cap"`.
  An `onCellUpdate` hook lets the CLI layer persist `run.json` after every
  submit/collect/retry, not just once at the end.

  New `src/node/observatory.ts` (SPEC §6: "src/node — fs, git
  introspection, config loader") — the one place besides `cli/verify.ts`
  that touches `node:fs` for `observatory/**`, so every file-shape decision
  (suites, presentations, panel, pricing, `plan.json`/`run.json` living
  under `readings/<rg>/`, readings, the index chain) is made once. New CLI
  subcommands `tiltmeter plan` and `tiltmeter run` (`src/cli/commands/`):
  `plan` builds the full suites×panel matrix, estimates cost (exact
  on-key, `--offline` heuristic off-key — refuses without a key unless
  `--offline`), cap-checks, writes `plan.json`; `run` re-validates
  freshness (`E_PLAN_STALE` → exit 5), refuses to start fresh over an
  existing `run.json` (must pass `--resume`), writes a `skipped` index
  entry and exits clean BEFORE spending anything when `ANTHROPIC_API_KEY`
  is unset (SPEC §8's 60-day mitigation: still a commit), otherwise
  executes via `executeRunGroup` and writes readings + `run.json` + an
  index-chain entry. `runCli` gained an optional `deps` parameter
  (`buildClient`/`now`/`harnessCommit`) — `src/cli/index.ts` (the bin)
  never passes it (real client, real clock); every test does, which is
  what makes the full CLI wiring testable at $0 with zero network.
  New `src/cli/exit-codes.ts` (`CLI_EXIT`, re-exported from `cli/run.ts`
  for backward compatibility): `CAP_REFUSED = 3`, `PLAN_STALE = 5`.

  `.github/workflows/ci.yml` gains a `workflow_dispatch` trigger and a
  `live-smoke` job (SPEC §12: "`--sync --limit 2 --model claude-haiku-4-5`,
  ≈$0.002. Never on PRs.") — wired but deliberately UNEXECUTED per SPEC
  §14's own M4 gate: no `ANTHROPIC_API_KEY` secret is configured on this
  repo yet, and `observatory/suites/` is empty until M5, so the job
  safely no-ops on both counts even if manually dispatched.

  Gate (docs/SPEC.md §14 M4: "Fake-client tests for every §9 row; live
  smoke on dispatch costs <$0.01"): every §9 failure-contract row that
  applies at M4 has a passing fake-client (or mocked-fetch) test —
  backoff/Retry-After/≤3-attempts, truncation→noResult, partial/denominator
  invariants (unchanged from M1-M3), the duplicate-spend guard, the
  batch-expiry one-retry rule, cap-trip mid-run abort, model-404→
  unavailable, missing-key→skipped, and stale-plan→`E_PLAN_STALE`. Live
  smoke stays wired-but-unexecuted, exactly as scoped. 253 tests green (26
  files), zero regressions to the 162 from M0-M3.

- M3 (statistics, offline, $0 — docs/SPEC.md §14 / §5): `core/stats.ts`'s
  `pairedPercentileBootstrap` — the seeded paired percentile bootstrap over
  ITEMS (not trials), `B = 10,000` resamples, 95% CI via nearest-rank
  percentiles. `compareReadings` (`core/compare.ts`) now classifies with
  `classifyBootstrap` (CI excludes 0 AND `|D| >= MDE`) in place of M1/M2's
  mean-delta-only rule — `classify` stays exported for the calibration
  harness. The seed is `seedFromHex8(sha256Hex(bodyHashA + bodyHashB))`
  (order-dependent, matching `delta`'s own directionality) feeding ONE
  continuing `mulberry32` stream consumed across every declared metric in
  the suite's declared order — deterministic and reproducible from the two
  readings' `bodyHash`es alone, never analyst-chosen. `MetricDelta` gains
  `ciLow`/`ciHigh`/`bootstrapB`. A behavior change worth calling out: a
  single fully-flipped item out of 40 (`|D| == MDE` exactly) now correctly
  classifies `moved-within-noise` — under M1/M2's mean-delta-only rule it
  fired `regressed`, since only 1/40 items carry any signal the CI still
  straddles 0 for most resamples. This is the false-positive discipline
  SPEC §12's "near-miss" golden was written to describe.

  New pure module `core/calibration.ts` (SPEC §12's "the numbers that go in
  the README"): `runNullPairCalibration` (200 seeded trials, both readings
  drawn from identical per-item rates — the null hypothesis) and
  `runPlantedDegradationCalibration` (200 seeded trials, 8 of 40 items —
  20% — carry a clean planted regression against the same background noise
  the null sim uses). Both share a 40-item pool at a 0.9 per-item baseline
  pass rate, realistic enough that the per-item flaky-exclusion machinery
  (SPEC §5) gets exercised for real rather than assumed away. New
  `core/prng.ts` primitive: `bernoulliTrial(rng, p)`. Achieved (seeded,
  reproducible — see `evals/calibration/results/latest.json`):
  **false-positive rate 0.0% (0/200)**, comfortably under the ≤8/200 CI
  gate; **detection power 95.0% (190/200)**, comfortably over the ≥90%
  floor. `scripts/calibration-report.mjs` mirrors the sibling repo's
  `chaos-report.mjs` pattern exactly: `pnpm calibration` regenerates
  `evals/calibration/results/latest.json` + `RESULTS.md` and injects the
  `<!-- calibration:begin/end -->` block in this README; `pnpm calibration:check`
  (new CI stage, `calibration-drift`) fails on any drift between the
  committed docs and the committed json, without needing a build or
  re-running the sim (that re-verification is the `eval` stage's job, via
  `evals/calibration.eval.test.ts`).

  Gate (docs/SPEC.md §12/§14): both calibration gates green (numbers above);
  `evals/golden.eval.test.ts` carries 26 classifier goldens (>=24 required)
  at 100% exact match, covering every axis label (model/time/harness/
  null-pair/other), every cannot-attribute reason, multi-item flaky
  exclusion, opposing-metric worst-of resolution, and a launch-scale
  (108-item) suite. 162 tests green (17 files), zero regressions to the
  129 from M0-M2.

- M2 (attribution, offline, $0 — docs/SPEC.md §14 / §4): `compareReadings`
  (`core/compare.ts`) gains the axis-attribution gate — a comparison is
  computed only when exactly one of the five `AxisTupleKey` elements
  differs; anything else is `cannot-attribute` with `reasons[]` naming
  every co-varying element (the director's edge case:
  `["modelIdResolved","suiteSpecHash"]`, sorted, no delta emitted at all).
  Either reading not `status: "complete"` is `cannot-attribute(["incomplete"])`;
  a missing cell (`compareReadings(a, undefined)`) is
  `cannot-attribute(["missing-cell"])`; an alias resolving to a different
  snapshot id for the same requested model across run groups is
  `cannot-attribute(["provider-substitution"])` rather than a deliberate
  model-axis comparison. Attributable comparisons are now labeled with
  which of SPEC §4's axes they sit on (`model` / `time` / `harness` /
  `null-pair` / `other`). Per-item `held`/`broke`/`fixed`/`flaky` labels
  land here too (`ItemReading` now carries `polarity`, since `compare`
  never has `Suite` context) — a flaky item (`0 < passes/k < 1` on either
  side) is excluded from a metric's delta and its `n` (MDE denominator)
  entirely, not just left at its old value; the classification rule itself
  is still M1's mean-delta-vs-MDE (the bootstrap CI arrives at M3, over the
  exact same per-item pairs this milestone builds). New pure modules:
  `core/rebaseline.ts` (stale-cell detection + `assertRebaselined`, which
  throws `E_AXIS_CONFLICT` if a stale reading is used before its suite's
  rebaseline run group has landed), `core/index-chain.ts` (the
  `readings/index.json` append-only hash chain — `appendEntry` derives
  `prevHash` from the chain's own tail, `verifyChain` walks it end to end),
  and `core/verify.ts` (`verifyReadingBodyHash`, `verifyCorpus`, and
  `verifyGitPreRegistration` — the SPEC §7 pre-registration proof's git walk
  is explicitly M5; its stub's return type has no `ok` field, so nothing
  can mistake it for a pass). `tiltmeter verify` (new CLI subcommand,
  `src/cli/verify.ts`) reads `observatory/readings/**` off disk, checks
  every reading's body hash and the index chain, and always prints the
  git-walk stub's message — exit 0 on an empty corpus (nothing committed
  yet) or a clean verify, exit 1 on any failure.

  Gate (docs/SPEC.md §12/§14): the 8 edge goldens — positive, negative,
  negative (near-miss, via a flaky single-item wobble), the director's case
  (harness edited AND model changed), a partial reading, flaky items,
  alias substitution, and same-axes-different-run-group (time axis) — all
  pass in `evals/golden.eval.test.ts`. 129 tests green (15 files).

- M1 (walking skeleton, offline, $0 — docs/SPEC.md §14): suite Zod schema
  (`core/suite.ts`) with `suiteSpecHash` excluding only `docs` (§3.1
  Decision 3); the `skill-tool@1` presentation as committed JSON
  (`observatory/presentations/skill-tool@1.json`) plus a renderer to
  `RequestPlan[]` (`core/presentation.ts`) — a `skill-description` artifact
  becomes a `Skill`-tool enum entry, a `tool-schema` artifact becomes a
  `tools[]` entry verbatim; three deterministic scorers — `tool-called`,
  `no-tool-called`, `tool-in-set` — reading only the first `tool_use` block
  (`core/scorers.ts`); `FakeModelClient` in `"./testing"`, scripted by item
  id + attempt, plus fixture builders (`buildFixtureSuite`,
  `scriptForBehavior`); `run` (`core/run.ts`) writes one reading per §3.3
  with completeness accounting where the denominator is always `items × k`
  and `noResult` is never scored as a fail; `compare` (`core/compare.ts`)
  emits a verdict from a per-metric mean delta against a default MDE of
  `1/n` — the seeded paired bootstrap arrives at M3. In-repo pure SHA-256
  (`core/sha256.ts`, ported from the sibling repos) and canonical JSON
  (`core/canonical.ts`, sorted keys / 2-space / LF / trailing newline,
  matching snapgauge) back every hash in the project. A found-by-testing
  fix: `falsePositiveRate` is a lower-is-better metric and needed its own
  directionality in `compare`'s classifier — every other declared metric is
  higher-is-better; guessed wrong, it silently inverts a verdict, so it is
  looked up by name rather than inferred.

  Gate (docs/SPEC.md §14): `evals/golden.eval.test.ts` — a 40-item fixture
  suite with 12 items flipped k/k→0/k classifies `regressed`; a
  byte-identical pair from a different run group classifies
  `moved-within-noise`. 75 tests green (11 files: the eval file plus unit
  coverage for canonical JSON, sha256 [FIPS vectors + node:crypto
  cross-check], the seeded PRNG, the suite schema, the presentation
  renderer [incl. validating the committed `skill-tool@1.json`], scorers,
  `run`, `compare`, and `FakeModelClient`).

- M0: pnpm workspace (`packages/tiltmeter`), TS strict + `noUncheckedIndexedAccess`,
  ESLint 9 flat config with the `src/core` + `src/testing` no-node-builtins /
  no-fetch boundary rule (docs/SPEC.md §6), Vitest 4 unit+eval projects,
  five-stage CI (typecheck → lint → unit → e2e:smoke → eval) plus build +
  pack-check guards, MIT license with brand-asset carve-out, SECURITY.md
  (the §9/§13 checklist, committed ahead of the surfaces it governs),
  docs/SPEC.md committed. `apps/web` (the static site, docs/SPEC.md §10) is
  **deferred past M0** — every Vercel deploy on this machine is James-gated
  program-wide, and there is no web app to deploy yet in any case; `e2e:smoke`
  is an explicit `echo` no-op until M6 rather than a silently-skipped stage.
