# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: semver.

## [Unreleased]

### Added
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
