# Security

tiltmeter is pre-release. This policy is committed at M0, before the surfaces
it governs exist, so the build is held to it rather than retrofitted (the
same discipline snapgauge's SECURITY.md uses). Headings below are the binding
checklist from docs/SPEC.md §9 (failure contracts) and §13 (acceptance
criteria); each is marked with the milestone where its enforcement surface
lands. "Applies from M`n`" means the surface already exists and the rule is
live today, not a promise.

## BYOK: `ANTHROPIC_API_KEY` handling — lands at M4

The key is read from the environment only — never a CLI flag (shell
history), never written to disk, never sent anywhere but `api.anthropic.com`.
The public site (M6) has no key field and no server; there is no request
path by which a visitor's action can spend it.

## No DB, and the reason stated — applies from M0

There is no database anywhere in this design. Every durable artifact — a
suite, a presentation, a reading, the readings index — is a committed JSON
file, canonicalized (docs/SPEC.md §3.3) and hash-chained. Git history is the
audit log; there is nothing else to secure or leak.

## Typed error taxonomy — no provider strings echoed — lands at M4

`core/errors.ts` (from M0) defines the closed set of error codes
(`E_CAP`, `E_PLAN_STALE`, `E_AXIS_CONFLICT`, `E_PARTIAL`, `E_PROVENANCE`,
`E_IMMUTABLE_ITEM`, `E_PROVIDER`). `E_PROVIDER` — the real Anthropic client's
failure class (M4) — is reported by class only; the raw provider error body
is never surfaced in CLI output, a reading, or the site, since it can carry
account- or infra-identifying detail that has no reason to be public.

## `noResult` / partial-reading handling — never scored as a fail — applies from M1

A trial that could not be scored (transient failure, truncation) is
`noResult`, not `fail`. The completeness denominator is always `items × k`;
missing trials are never dropped, because dropping them would bias the rate.
A reading with any `noResult > 0` is `status: "partial"`.

## Partial readings excluded from every aggregate — lands at M2

A `partial` reading is never compared. `compare` refuses across it with
`cannot-attribute(incomplete)` rather than silently averaging over fewer
trials than the denominator claims.

## Axis conflicts refuse rather than guess — lands at M2

`compare` computes a delta only when exactly one axis element differs
between two readings (docs/SPEC.md §4). Anything else — including the
director's edge case, a harness edit *and* a model change in the same
window — is `cannot-attribute` with `reasons[]` naming every axis element
that co-varied, and **no delta number is emitted**. This is a security
property as much as a statistical one: it is the mechanism that prevents a
misleading number from ever being published.

## Alias substitution is a labelled event, not a silent swap — lands at M2

Panel entries prefer dated snapshot ids. When an alias resolves to a
different snapshot between run groups, that is published as a
`provider-substitution` event and every comparison across it is
`cannot-attribute` — never averaged through as if nothing happened.

## Crash / resume never double-spends — lands at M4

`run --resume` reconstructs a reading from committed batch ids and never
re-submits a cell that already has one recorded. Deterministic
`custom_id = sha256(runGroup, suite, item, trial)` is written **before**
submission, so a crash between submit and write cannot cause a duplicate
charge.

## Cost caps — provider console limit + runner-enforced caps — lands at M4 (runner) / M7 (console + schedule)

Two independent layers (docs/SPEC.md §8): a dedicated Anthropic API key with
a monthly spend limit set in the console (the only cap that survives a
leaked key), and runner-enforced `maxRunUsd` / `maxCellUsd` / `maxMonthUsd`
tracked in the committed index. A cap trip stops submission and writes the
reading `aborted` — never a silent skip, never a partial reading presented
as complete.

## Suite edited between plan and run (`E_PLAN_STALE`) — lands at M4 / M7

`plan.json` pins the `suiteSpecHash` it was built from; a mismatch at `run`
time is a usage error (exit 4, "re-plan"), not a silent re-plan on the
runner's own authority.

## Fork PR / external-contributor secret boundary — lands at M7

`reading.yml` runs on `schedule` and `workflow_dispatch` only, guarded by
`if: github.repository == 'jamessuuu/tiltmeter'`, with `permissions:
contents: write` and nothing else. No workflow reachable by a fork PR or
external input ever sees `ANTHROPIC_API_KEY`.

## No unauthenticated write path — because there is no write path — lands at M6

The site (`apps/web`) is 100% static, prerendered at build time from
committed `observatory/` data, with `export const dynamic = 'error'` on
every route. There are zero API routes and zero database writes to gate —
the acceptance bar is met structurally, not by an auth check that could be
misconfigured.

## WAF rate-limit rule — lands at M6

One Hobby-tier WAF rule bound to `/*`, documented here once it exists. The
worst case of hostile traffic against a fully static site with no model
spend path is a 30-day platform pause of a site whose every published claim
still reproduces from the repo.

## Reverse threat: suites vendor your artifact text — applies from M1

A suite's `materialized` field (docs/SPEC.md §3.1 Decision 1) is the exact
text sent to the model, committed so a reading reproduces forever. If a
suite is built from a private harness (a skill description, a routing
prompt, a tool schema that is not meant to be public), **review the suite
file before committing it** — vendoring is the point, and it is not
reversible after a public push. James's own suites (M5) draw only from
`~/.claude` (marked `origin: "private"`) and public repos (`origin:
"public"`, byte-verified against a commit); nothing from the EMPLOYER or
CLIENT worlds may ever appear in a suite committed to this repo.

## Reporting

Email jameslorenzsantos@gmail.com. No bug bounty; honest credit given.
