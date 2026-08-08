# Operations runbook

This is the "how to actually run the thing" doc `docs/SPEC.md` doesn't try
to be. It covers the one-time setup a human (James) does before `reading.yml`
is ever allowed to spend money, what the three scheduled workflows do day to
day, what a cap-abort looks like when it happens, and how to read a
published reading. Nothing in this file has been exercised for real — no
workflow here has ever run (HARD RULE, M7/M8: no live API call, no key use).
It is the plan the workflows already implement, made legible before the
first real Monday.

## 1. One-time setup: the dedicated Anthropic workspace + its console limit

SPEC §8/§15 Q1: **the provider-enforced console spend limit is the only cap
that survives a leaked key.** Everything else in this doc (`maxRunUsd`,
`maxCellUsd`, `maxMonthUsd`) is enforced by this repo's own code — real, but
worthless against a key an attacker has copied out of a compromised secret
store and is spending directly against the API, bypassing this repo
entirely. Only a limit set on Anthropic's own infrastructure holds in that
case.

Before `reading.yml` is ever unpaused (before `ANTHROPIC_API_KEY` is added
to the repo's secrets at all):

1. **Create a dedicated workspace** in the Anthropic Console — not the
   workspace any other project's key lives in. A dedicated workspace means a
   compromised `tiltmeter` key can only ever spend within that workspace's
   limit, never anyone else's budget.
2. **Set a monthly spend limit on that workspace.** SPEC §8 budgets this at
   **$20/month** — headroom over the ~$8–10/mo the weekly cadence actually
   costs (§3 below), enough to absorb a bad week without silently blocking
   the month, tight enough that a fully leaked key cannot run past double
   digits before Anthropic's own enforcement stops it. If the Console ever
   stops supporting a per-workspace monthly cap (SPEC §15 Q1's fallback),
   use a dedicated low-limit key plus a billing alert instead, and update
   this section to say so — the fallback is a policy change here, not a
   code change anywhere in the repo.
3. **Mint an API key scoped to that workspace.** Never the key any other
   project uses.
4. **Add it as `ANTHROPIC_API_KEY`** in this repo's Settings → Secrets and
   variables → Actions. `reading.yml` and `release-watch.yml` are the only
   two workflows that ever read it (`scripts/lint-workflow-secrets.mjs`
   asserts this mechanically in CI — see SECURITY.md), and both degrade
   cleanly (a recorded skip, never a crash) if it is absent, so there is no
   rush and no risk in leaving it unset for a while after M7 lands.

Nothing else in this repo can create or raise that console limit — it is a
Console setting, not a file here, and it is the one step in this whole
runbook a human does by hand every time (dedicated workspace, then limit)
rather than something a workflow does.

## 2. The two cap layers, and how they compose

| Layer | Where | Value | Survives a leaked key? |
|---|---|---|---|
| Provider-enforced | Anthropic Console, per workspace | $20/month (§1 above) | Yes — this is the point of it |
| Runner-enforced | `core/caps.ts`, checked by `plan` and re-checked by `run` after every cell | `maxRunUsd = 3.00`, `maxCellUsd = 1.50`, `maxMonthUsd = 15.00` | No — it is code in this repo; a key used outside this repo's CLI never sees it |

The runner cap ($15/mo) sits *under* the console cap ($20/mo) on purpose:
the runner is meant to be the one that actually trips in normal operation
(a bad week, a pricing change, a suite that grew), leaving the console limit
as the layer that only matters when the runner's own logic is bypassed
entirely (a leaked key used directly against `api.anthropic.com`, or a bug
in this repo nobody has caught yet).

`maxMonthUsd` is checked against **`readings/index.json`'s own committed
`costUsd` sum for the current calendar month** — a real number derived from
git history, never a running estimate that could drift from what actually
happened.

## 3. Cadence and cost — the choice this doc doesn't make for you

SPEC §8's own numbers, unchanged by M7 (this section documents the
decision; it does not decide it — see SPEC §15 Q4, "James's, not the
architect's"):

| Cadence | Standing panel | Approx. cost | Notes |
|---|---|---|---|
| **Weekly (spec default)** | Haiku 4.5 + Sonnet 5 + the Haiku null pair | **≈ $1.45/week** (→ $1.81/week after the 2026-08-31 Sonnet 5 price change) → **≈ $8.2–9.6/month** (4 weekly run groups + ~1 release-triggered run at k=5) | What `reading.yml`'s `cron: '0 3 * * 1'` runs today |
| **Biweekly fallback** | Haiku 4.5 standing only (Sonnet 5 on release runs only) | **≈ $4/month** | A config change (the cron expression + `observatory/panel.json`), never a code change or a redesign |

Switching cadence is exactly two edits: `reading.yml`'s `cron:` expression,
and `observatory/panel.json`'s standing entries (drop Sonnet 5's `standing`
role to fall back to release-only). Nothing else in the pipeline — `plan`,
`run`, the caps, the site — cares which cadence is active; a run group is a
run group either way.

## 4. What a cap-abort actually looks like

A cap trip is never a silent gap (SPEC §8/§9) — here is exactly what shows
up when one happens:

1. **Mid-run** (the common case — `run` re-checks ACTUAL usage after every
   completed cell): the next cell never submits. Its reading is written
   `status: "aborted"`, `abortedBy: "cap"`. Every cell before the trip keeps
   whatever result it already had (complete or otherwise) — the abort never
   retroactively invalidates a cell that already finished.
2. **`readings/index.json`** gets a new entry: `status: "aborted"`,
   `reason: "spend cap reached mid-run"`, and the real `costUsd` actually
   spent before the stop (never the plan's estimate).
3. **`reading.yml` still commits** — an aborted run group is exactly as
   committable as a complete one; the workflow's commit step does not
   distinguish them.
4. **The public site shows it.** `/readings/<rg>` renders the aborted cells
   plainly rather than hiding them, and an aborted run group is excluded
   from every cross-run comparison (`cannot-attribute(incomplete)` for a
   `partial` reading; an aborted cell simply has no comparable reading on
   the other side).
5. **Before a cell is even attempted** (plan-time — the whole run group
   would exceed a cap before anything runs): `tiltmeter plan` refuses
   outright (`E_CAP`, exit `CAP_REFUSED`) and would normally write nothing
   at all. `runScheduledReading` (`packages/tiltmeter/src/cli/commands/scheduled-reading.ts`,
   what `reading.yml` actually calls — see M7) closes that specific gap: it
   pre-checks the committed month-to-date against the caps BEFORE calling
   `plan`, and if `plan` still refuses on a race, it writes a committed
   `status: "skipped"` index entry with a reason naming the cap either way.
   **This is the mechanism, not a promise** — `scheduled-reading.test.ts`
   exercises both the preflight-catches-it and the plan-refuses-anyway
   paths against a fake client.

Nothing above requires touching a file by hand to recover — the next
scheduled run simply tries again against a fresh month-to-date figure (or a
new month, once the calendar rolls over).

## 5. Reading a published reading

Every real run group's page (`/readings/<runGroupId>` once one exists — see
`observatory/readings/README.md` for why there isn't one yet) carries, per
SPEC §10:

- **Every cell** in the run group — suite × model — with its `status`
  (`complete` / `partial` / `aborted` / `skipped` / `unavailable`).
- **Completeness**: `expectedTrials` vs `ok`/`error`/`noResult` — the
  denominator is always `items × k`, never silently shrunk.
- **Actual USD cost**, not the plan-time estimate — `cost.actualUsd` on
  each reading.
- **The per-item table**: held / broke / fixed / flaky, against the
  *previous* comparable reading (same suite, same axes except the one that
  legitimately varied).
- **The pre-registration triple**: when the suite was registered (a real
  git commit date), when the model was released (`models.json`'s cited
  `releasedAt` + `sourceUrl`), and when this reading was taken — with GitHub
  permalinks, so the claim "this suite existed before this model did" is a
  30-second check, not a trust exercise.
- **The exact `tiltmeter` command** that reproduces the reading from the
  pinned commit, and a raw-JSON link to the reading file itself.

The one thing a reading page never shows: a number about the model alone.
Every figure on it is scoped to `(suite, harness commit, model)` — the
death-condition guard (SPEC §1/§13) that makes this an observatory of
*this harness*, not a leaderboard.

## 6. Day-to-day: what each scheduled workflow does

| Workflow | Cadence | Spends? | On a normal week |
|---|---|---|---|
| `reading.yml` | Weekly (`cron: '0 3 * * 1'`) + manual | Yes (BYOK) | Runs the standing panel across every suite, commits the readings + a hash-chained index entry — real, `skipped`, or `aborted`, always something (§4 of this doc; SPEC §8's 60-day mitigation) |
| `release-watch.yml` | Daily + manual | No (Models API is free) | Usually a no-op (no new model families). When one appears, opens a PR adding it to `observatory/models.json` with `status: "release-only"` — merging the PR does **not** add it to the standing panel; that is a separate, deliberate edit to `observatory/panel.json` |
| `health.yml` | Daily + manual | No | Usually a no-op. Fails red and opens (or leaves open) a `observatory-stale` issue only when the newest REAL reading (not a skipped/aborted commit) is more than 14 days old |

All three are `schedule` + `workflow_dispatch` only, guarded by
`if: github.repository == 'jamessuuu/tiltmeter'` — see SECURITY.md's "Fork
PR / external-contributor secret boundary" and `ci.yml`'s `lint-workflows`
stage, which checks this mechanically rather than relying on this sentence
staying true by accident.
