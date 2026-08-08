# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: semver.

## [Unreleased]

### Added
- M7 (workflows — docs/SPEC.md §8/§9/§14): `reading.yml` (weekly
  `cron: '0 3 * * 1'` + `workflow_dispatch`), `release-watch.yml` (daily,
  diffs the live Anthropic Models API against `observatory/models.json`
  and opens a PR — the human gate, never an auto-added panel entry),
  `health.yml` (daily, fails and opens/reuses a labelled issue when the
  newest REAL reading — not a skipped mitigation commit — is >14 days old).
  All three committed, none ever executed (HARD RULE: no live API call, no
  key use in this build).

  `packages/tiltmeter/src/cli/commands/scheduled-reading.ts` is what
  `reading.yml` actually calls (via `scripts/reading-run.mjs`'s thin
  "import the compiled dist" shim, mirroring `calibration-report.mjs`) —
  NOT a new documented `tiltmeter` subcommand; SPEC §7's CLI table stays
  exactly as specified. It closes the one real gap in the 60-day
  auto-disable mitigation the existing `plan`/`run` pair left open:
  `tiltmeter run`'s missing-key skip already wrote a committed `skipped`
  index entry (M4, unchanged), but `tiltmeter plan` REFUSES on a cap
  breach and writes nothing at all — a silent gap for a scheduled run
  whose month is already spent. `runScheduledReading` reuses
  `core/caps.ts`'s own `checkCaps` as a plan-time preflight (an empty
  `cellEstimatesUsd` array still exercises the month-to-date-vs-cap
  compare — no new cap logic, just a new caller) and, on a race past that
  preflight, catches `plan`'s own `CAP_REFUSED` too — either way a
  `status: "skipped"` entry lands and commits. A genuine configuration
  error (no suites, bad schema) still propagates and fails the job red,
  rather than being swallowed as a skip.

  `core/health.ts` (`computeHealthState`/`newestRealReadingAt`, exported
  from `"."`) mirrors `apps/web/lib/dead-man.ts`'s shape at a 14-day
  threshold for a different audience (CI failure + issue, not a site
  banner) — and deliberately does NOT count a `skipped` entry as "a
  reading landed," so the mitigation's own commits can never mask real
  staleness. `src/node/git.ts` gained `currentCommit` (the real `HEAD` SHA
  the bin now resolves for `harnessCommit` — previously always
  `"unknown"` outside a test's injected value, a real gap `src/cli/index.ts`
  closes with no change to any existing test's injected deps).

  The fork-PR/secret-boundary property (SPEC §9, SECURITY.md) is now
  CHECKED, not just reviewed: `src/node/workflow-lint.ts`
  (`lintWorkflowSecretsInDir`/`findWorkflowSecretViolations`) parses every
  `.github/workflows/*.yml`, and `ci.yml`'s new `lint-workflows` stage
  fails red if any job referencing a secret is reachable by
  `pull_request`/`pull_request_target`/`issue_comment`/similar without an
  explicit `if: github.event_name == 'workflow_dispatch'` guard —
  deliberately narrow pattern-matching (not a full expression evaluator)
  that fails TOWARD flagging on anything it can't confidently read as
  narrowed. `workflow-lint.test.ts` exercises this exact repo's real
  `ci.yml` as a fixture (its `live-smoke` job mixes a `pull_request`-
  triggered job with a `workflow_dispatch`-gated one in the same file —
  the one case the check must NOT false-positive on) alongside synthetic
  good/bad cases, including a named regression guard for the classic
  "`on:` parses as a YAML 1.1 boolean" GitHub Actions footgun (verified
  NOT present in js-yaml v4's default schema before relying on it).

  `docs/OPERATIONS.md` (new): the dedicated-workspace + console-spend-limit
  runbook (SPEC §15 Q1 — the provider-enforced cap is the only one that
  survives a leaked key, and setting it is a manual Console action no code
  here can perform), the two cap layers and how they compose, the weekly
  (~$8–10/mo) vs biweekly (~$4/mo) cadence choice with both cost figures,
  exactly what a cap-abort looks like end to end, and how to read a
  published reading page.

  SECURITY.md: fixed a falsified claim found on review (`grep`-verified
  against `plan-run.test.ts`) — "a mismatch at run time is a usage error
  (exit 4, 're-plan')" was never true; the actual, tested behavior is a
  DISTINCT exit code (`CLI_EXIT.PLAN_STALE = 5`, deliberately not reusing
  `USAGE = 4` — see `exit-codes.ts`'s own docstring, unchanged). Updated
  the fork-PR section to name `release-watch.yml` too (the second, only
  other workflow that ever references the secret) and to point at the new
  mechanical check rather than asserting the property by prose alone.

  Gate (docs/SPEC.md §12/§14): 334 pre-M7 tests plus new coverage for
  `currentCommit`, `computeHealthState`/`newestRealReadingAt`,
  `workflow-lint`'s pure functions (incl. the real-`ci.yml` fixture), and
  `runScheduledReading`'s five scenarios (no key, cap-already-reached,
  plan-refuses-on-a-race, a clean end-to-end run, and a genuine config
  error that must NOT be swallowed) — all green.

- M6 (the site — docs/SPEC.md §14/§10, `apps/web`, Next.js 16.3.0 App
  Router / React 19.2 / TS strict + `noUncheckedIndexedAccess` / Tailwind 4):
  five routes, every one prerendered with `output: "export"` (a structural,
  not conventional, "zero API routes / zero DB / no unauthenticated write
  path — because there is no write path") AND `export const dynamic =
  "error"` on every route (SPEC §7's literal words, a second, redundant,
  self-documenting guard). `/suites/[id]` generates four REAL static pages
  from M5's committed suites (items, artifacts, provenance, current
  `suiteSpecHash`); `/readings/[runGroupId]` generates one honest
  placeholder page (`none-yet`, real content, not a fake reading — see
  below) since `observatory/readings/` is still empty; `/` is the
  instrument (per-suite series with SPEC §4 hard-break annotations at every
  `suiteSpecHash` change, and — with zero readings today — SPEC §11's exact
  launch-state copy, computed from real suite data: "tiltmeter launched
  2026-08-09 with 4 pre-registered suites and 108 items…"); `/models` is
  the death-condition guard made literal — panel/model metadata only, and
  `e2e/models.spec.ts` asserts structurally (table headers, no numeric
  value on the page) that no ranking UI exists, not merely that the words
  "rank"/"score" are absent (the page's own disclaimer prose legitimately
  contains them); `/methodology` covers presentation templates, all eight
  scorers, k/temperature and why not 0, the axis rules, the bootstrap, the
  noise floor, cost policy, and SPEC §13's Limitations verbatim.

  Every page reads `observatory/**` at BUILD TIME ONLY (`apps/web/lib/observatory.ts`,
  plain Node `fs`, Server Components / `generateStaticParams`) through
  `tiltmeter`'s OWN Zod schemas via a workspace dependency — SPEC §13's
  "Zod at every boundary… site build inputs," satisfied by construction: a
  malformed committed file fails the build, never renders silently wrong.
  The dead-man banner (`lib/dead-man.ts` + `components/DeadManBanner.tsx`)
  is deliberately split: a pure `computeDeadManState` (unit-tested at the
  exact >10-day boundary — 10.0 days not stale, one second past IS stale)
  driving a CLIENT component that computes "now" in the visitor's own
  browser at page-load (`useEffect`, never baked into the static HTML at
  build time) — SPEC's "works with functions paused" requirement, satisfied
  because there are no functions, and "client-side arithmetic" because a
  statically exported page never changes after the day it was built. With
  zero readings ever recorded, the banner correctly renders nothing (a
  distinct, honest state from staleness — the launch-state copy owns it).

  Footer (chip mark + "Built by James Lorenz Santos" + agentjames.vercel.app
  + the GitHub repo link, explicitly no hire-me CTA — BRAND-KIT.md D1) lives
  once in the root layout, so it is structurally on every page rather than
  copy-pasted. Favicon + OG metadata reference the committed
  `scripts/brand.mjs` output (`apps/web/public/brand/**`, regenerated via
  the new root `pnpm brand` script — byte-identical, verified — and a new
  CI `brand-drift` stage fails on any hand-edit drift, the same pattern
  `calibration-drift` already uses for the README block).

  Two real, load-bearing bugs found and fixed by testing, not inspection:
  (1) Turbopack (Next 16's default build engine) has an open upstream bug
  resolving `transpilePackages`' inherited/re-exported internal imports in
  a monorepo (vercel/next.js#85315/#85316/#63230) — `tiltmeter`'s own
  TS-NodeNext-style `.js`-suffixed specifiers pointing at sibling `.ts`
  files (correct for `tsc`/Vitest) failed to resolve under Turbopack;
  fixed via the documented `next build --webpack` workaround plus a
  standard `resolve.extensionAlias` in `next.config.ts`. (2) Next.js 16's
  App Router made `params` a `Promise` rather than a plain object; using it
  synchronously (`params.id` instead of `const { id } = await params`)
  does not throw a type error under the version originally scaffolded but
  silently evaluates to `undefined`, meaning `notFound()` fired on EVERY
  visit to `/suites/[id]` and `/readings/[runGroupId]` while the static
  file server still returned HTTP 200 (Next's own not-found boundary is a
  real, prebuilt HTML file) — invisible unless a test actually asserts on
  page CONTENT rather than just HTTP status, which is exactly what
  `e2e/every-page.spec.ts`'s "all four launch suites are reachable" test
  caught. Fixed in both dynamic routes.

  Static export's `output: "export"` requires at least one static param
  per dynamic route segment (`generateStaticParams` cannot return `[]`) —
  since `observatory/readings/` is genuinely empty, `/readings/[runGroupId]`
  uses one honest, clearly-named placeholder param (`none-yet`) whose page
  renders real "no run group has been recorded yet" content, never a
  fabricated reading; the moment a real run group lands, `listRunGroupIds()`
  returns it and the placeholder stops being generated at all.

  Playwright e2e (`apps/web/e2e/**`, `pnpm e2e` from root) replaces the CI
  `e2e:smoke` echo no-op with 14 real tests against the actual static
  export (`next build --webpack` then `serve`, never `next dev`): `/`
  renders correctly with `javaScriptEnabled: false` (proving the core
  content is real server-rendered HTML, not client-JS-dependent); footer +
  favicon + no-hire-me-CTA on every route shape (static, dynamic-suite,
  dynamic-reading); the exact SPEC §11 launch-state copy; the `/models`
  death-condition guard; the dead-man banner correctly absent with zero
  readings. Two Vitest unit tests (`apps/web/lib/*.test.ts`, wired into the
  root "unit" project) cover the dead-man boundary and the hard-break
  series logic independent of React/Playwright.

  Gate (docs/SPEC.md §14 M6): all five routes build under `output: "export"`
  with `dynamic: "error"`; 14/14 e2e tests green; brand assets byte-identical
  (zero drift); 304 unit tests green (30 files, +17 from apps/web),
  zero regressions. All CI stages green: typecheck, lint, unit, e2e-smoke
  (now real), brand-drift (new), eval, build, pack-check, calibration-drift.

- M5 (the observatory — docs/SPEC.md §14/§11, DATA ONLY, zero code in
  `observatory/`, zero live API calls): four launch suites authored from
  REAL artifacts on this machine — `house-skill-activation` (10 real
  `SKILL.md` frontmatter descriptions from `~/.claude/skills`: taste, retro,
  save, scout, pulse, hub, inbox, launch, new-project, new-guild — 20
  positive + 12 negative), `mcp-tool-selection` (real, currently-live tool
  schemas from three PUBLIC MCP server repos — `upstash/context7`
  (`resolve-library-id`/`query-docs`), `github/github-mcp-server`
  (`search_issues`/`search_code`/`list_issues`), `microsoft/playwright-mcp`
  (`browser_navigate`/`browser_snapshot`/`browser_take_screenshot`/
  `browser_click`/`browser_type`) — each artifact's provenance carries the
  exact repo, commit SHA, and blob SHA fetched live via `gh api`; 20
  positive + 8 negative, including the genuinely confusable pairs SPEC §11
  asked for — `resolve-library-id` vs `query-docs` (both take a free-text
  `query`), `search_issues` vs `search_code` vs `list_issues`, and
  `browser_snapshot` vs `browser_take_screenshot` (the upstream README
  itself warns about this exact confusion). Nothing from any EMPLOYER or
  CLIENT world appears in any suite — checked twice: a grep sweep during
  authoring caught and replaced two real client-name references
  (`routing-adherence` originally named two real employer-side clients and one real
  client-world engagement by name; all three are now generic placeholders), and
  `observatory.test.ts` asserts `mcp-tool-selection`'s artifacts are 100%
  `origin: "public"`.

  `routing-adherence` (16 positive + 6 negative) vendors the worlds-router +
  routing-discipline blocks from `~/.claude/CLAUDE.md`/`ECOSYSTEM.md`,
  presented with three tool-schema artifacts this suite's own `docs` field
  documents as authored encodings (not verbatim file content) of that
  policy: `route(world)`, `split_task()` (CLAUDE.md's own explicit "one
  session per world" rule), and `select_pattern(pattern)` (ECOSYSTEM.md §4's
  routing table, exercised via a genuine two-step `tool-order` sequence
  mirroring ECOSYSTEM.md's own LEVEL 0/LEVEL 1 chain of command — world
  routing happens first, pattern selection second) plus a `literal-prefix`
  "AMBIGUOUS:" channel for a request that genuinely can't be routed without
  guessing. `output-contract` (18 positive + 8 negative) renders
  ECOSYSTEM.md §6's Brief/Verdict/Handoff artifact vocabulary as typed tool
  schemas (`json-schema-valid`/`arg-required-keys`) plus a `decline
  (reason_code)` channel (`arg-enum`) — SPEC §11's own phrase, honestly
  recorded as authored for this suite rather than vendored from an existing
  doc. **Exactly 108 active items, 31.5% negative**, matching SPEC §11's own
  numbers precisely (verified in `observatory.test.ts`).

  `core/suite.ts`'s `ExpectSchema` gains the five scorer kinds M1 deferred
  (`core/scorers.ts` implements them): `arg-enum`, `arg-required-keys`,
  `tool-order` (the one scorer that reads the FULL `toolUseBlocks` sequence,
  not just the first), `literal-prefix` (a byte-literal check against a new
  optional `ModelTrialResponse.text` field — extracted from real `text`
  content blocks in `src/client/anthropic.ts`, scripted via `FakeModelClient`'s
  new `textTrial`/`multiToolTrial` helpers), and `json-schema-valid` (a
  deliberately minimal in-house structural validator — `type`/`required`/
  `properties`/`enum`/`items` only, no `$ref`/`oneOf`/`allOf`/`format` — the
  schema is carried INLINE on the item rather than as SPEC §3.2's literal
  `schemaRef` indirection, a recorded deviation that keeps every item
  self-contained for the immutability check below).

  New `core/models.ts` (`observatory/models.json`): cited `releasedAt` +
  `sourceUrl` per model, fetched live — Haiku 4.5 (2025-10-15,
  anthropic.com/news/claude-haiku-4-5), Sonnet 5 (2026-06-30,
  .../claude-sonnet-5), Opus 5 (2026-07-24, .../claude-opus-5), Fable 5
  (2026-06-09, .../claude-fable-5-mythos-5). New `observatory/panel.json`:
  the standing panel SPEC §8 names exactly — Haiku 4.5 + Sonnet 5 + the
  mandatory `haiku45-null` cell (`hasNullPair`, `core/plan.ts`, verified).

  New `core/lint.ts` + `tiltmeter lint` (`src/cli/commands/lint.ts`):
  negatives quota (already `meetsNegativesQuota` from M1), a maxTokens
  headroom floor (`4 * TYPICAL_TOOL_CALL_OUTPUT_TOKENS` — SPEC §9's own
  "4× the largest expected output" operationalized as a documented, generous
  fixed floor since a suite has no explicit per-item expected-output-size
  field), a dangling-artifact-ref check, and SPEC §3.1 Decision 2's
  anti-p-hacking item-immutability check — `checkItemImmutability` (core,
  pure) compares the current suite's items against the suite file's content
  at git `HEAD` (resolved by new `src/node/git.ts`, which every lint/verify
  git-walk goes through) byte-for-byte EXCLUDING the `retired` field (so
  retiring an item is the one allowed change; editing any other field, or
  removing an item outright instead of retiring it, both fail lint). All
  four committed suites lint clean.

  `tiltmeter verify`'s M2 stub (`verifyGitPreRegistration`, which always
  returned `implemented:false`) is REPLACED with the real SPEC §7
  pre-registration proof: `core/verify.ts`'s new `evaluatePreRegistration`
  is the pure decision (given a resolved commit + date + a model's cited
  `releasedAt`, is `suiteRegisteredAt < modelReleasedAt`); `src/node/git.ts`'s
  `findFirstCommitWithHash` is the git walk (`git log --follow` over a
  suite's file history, oldest first, recomputing `suiteSpecHash` at each
  commit via `git show <sha>:<path>` until the reading's exact pinned hash
  is reproduced) that resolves the facts the decision needs. `src/cli/verify.ts`
  runs this per reading found. Since `observatory/readings/` is
  DELIBERATELY EMPTY (see its own README — the first run group is a
  James-gated step M5 does not take), the walk today always reports
  "nothing to check yet" rather than a false pass; `src/node/git.test.ts`
  proves the walk itself against a real temp git repo (multi-commit
  history, a hash reached only after a later edit, a historical revision
  that no longer parses under the current schema).

  Gate (docs/SPEC.md §14 M5): `tiltmeter verify` green on the corpus (empty,
  honestly reported); all four suites lint clean; the Haiku↔Sonnet
  comparison and the null-pair noise floor are NOT published (no run has
  happened) — that is the correct, honest M5 state, not a gap. 317 tests
  green (30 files), zero regressions to the 253 from M0-M4.

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
