# tiltmeter — SPEC

**Project:** P1 (FLAGSHIP · evals/observability) · **Status:** approved for build · **Date:** 2026-08-08
**Binds to:** `showcase-program/PROGRAM.md` (constraints + D1–D6, esp. **D4 scheduler = GitHub Actions**),
`SELECTION.md` (P1 definition + death condition), `research/feasibility.md` (§4/§4.1/§4.2 platform
baseline, §5.C observatory sketch + YELLOW mitigation, §6 pricing + tokenizer warning, §7 cost safety),
`research/director-verdict.md` (finalist #1 + its eval plan), `research/market-research.md` (§2.C),
`BRAND-KIT.md`, `research/naming.md`.
**Seed asset:** `guilds/evals/trigger/run.mjs` + `README.md` — deterministic-first, judges never the
gate, negatives mandatory, false-positive rate reported. tiltmeter is that harness made reproducible,
pre-registered, and publishable.

---

## 1. Goal + non-goals

**Goal.** Tell an operator when a new model release moves *their* agent harness off true. The unit of
measurement is a **harness artifact** — a skill description, a tool schema, a routing prompt, an output
contract — pinned to a commit and probed with deterministic scorers. Two shipped things: a **BYOK local
runner** (`tiltmeter`, npm + CLI, points at your harness) and **James's public observatory** (committed
readings + a static site rendering the time series). Every published number reproduces from a pinned
commit with one command.

**Non-goals (hard guards — refusals, not backlog).**
1. **No capability benchmarking.** No metric about a model in isolation, ever. Enforced structurally:
   the reading schema has **no field for a cross-suite model aggregate**, and no page ranks models.
   Every published number is scoped to `(suite, harness commit, model)`. This is the P1 death condition.
2. **No LLM judge anywhere** — not in the gate, not as a diagnostic tier. If a probe cannot be scored
   deterministically, the probe is wrong; fix the probe.
3. **No visitor-triggered compute.** No API routes, no database, no key input field, no hosted run path.
4. **Not an agent-runtime driver.** tiltmeter presents your artifacts through a declared presentation
   over the Messages API; it does not drive Claude Code, your CLI, or your production loop (§13
   Limitations states this in the README).
5. **No cross-vendor panel at v1.** Anthropic first-party only. Nothing here compares vendors.

---

## 2. Repo layout and what ships

```
tiltmeter/                       GitHub jamessuuu/tiltmeter (public, MIT + brand carve-out)
  packages/tiltmeter/            npm `tiltmeter` — the ONLY published package (bin: tiltmeter)
    src/core/     suite | presentation | scorers | reading | compare | stats | cost | canonical
                  (pure, isomorphic, zero I/O, Zod types — no fetch, no fs, no env)
    src/client/   anthropic messages + batch client, count_tokens, retry/backoff
    src/node/     fs, git introspection, config loader
    src/cli/      commander bin — the only place with process.exit / env / cwd
    exports: "." → programmatic API · "./testing" → FakeModelClient + fixture builders
  observatory/                   James's instance: DATA AND CONFIG ONLY, zero code
    suites/*.suite.json  presentations/*.json  panel.json  models.json
    pricing/pricing.2026-08-08.json
    readings/<runGroupId>/{run.json, <suiteId>__<cellId>.json}   readings/index.json
  apps/web/                      Next.js 16.3 static site (Vercel project `tiltmeter`)
  evals/                         golden readings + calibration sims ($0, deterministic)
  .github/workflows/{ci.yml, reading.yml, release-watch.yml, health.yml, publish.yml}
  docs/SPEC.md  SECURITY.md  METHODOLOGY.md  README.md  scripts/brand.mjs
```

**The cut (question 1).** One repo, one published package, one observatory. The runner knows nothing
about James's suites; the observatory contains no code. A fork replaces `observatory/` and keeps
everything else. Rationale: the observatory is the runner's dogfood and answers the director's
"library nobody runs" failure mode — the tool's proof is that its author's harness is measured by it
weekly, in public. One CI, one release, one maintainer at 2h/week.

---

## 3. Data model

### 3.1 Suite (`observatory/suites/<id>.suite.json`) — the pre-registered artifact

```jsonc
{ "formatVersion": 1, "id": "house-skill-activation", "presentation": "skill-tool@1",
  "docs": "…free prose, the ONLY field excluded from suiteSpecHash…",
  "metrics": ["overall", "triggerRate", "falsePositiveRate"],   // declared, gate on the worst
  "sampling": { "k": 3, "temperature": 1.0, "maxTokens": 512 },
  "artifacts": [
    { "id": "skill.taste", "kind": "skill-description",
      "source": { "origin": "private", "repo": null, "path": ".claude/skills/taste/SKILL.md",
                  "field": "frontmatter.description", "capturedAt": "2026-08-08" },
      "materialized": { "name": "taste", "description": "Anti-slop constitution for design…" } } ],
  "items": [
    { "id": "taste-1", "probe": "activation", "polarity": "positive",
      "artifactRefs": ["skill.taste"], "registeredAt": "2026-08-09",
      "scenario": "I'm about to design the landing page hero…",
      "expect": { "scorer": "tool-called", "name": "Skill", "args": { "skill": "taste" } } },
    { "id": "neg-1", "probe": "activation", "polarity": "negative", "registeredAt": "2026-08-09",
      "scenario": "Fix the typo in the README on line 12.",
      "expect": { "scorer": "no-tool-called" } },
    { "id": "old-3", "retired": { "at": "2026-09-02", "reason": "artifact deleted upstream" }, … } ] }
```

**Decision 1 — artifacts are vendored *and* provenanced.** `materialized` is the exact text sent to the
model (committed, so the reading reproduces forever); `source` records where it came from and at what
fidelity. `origin: "public"` sources carry `repo` + `commit` + `blobSha` and CI re-fetches and asserts
byte-equality; `origin: "private"` (James's `~/.claude`) records `"vendored-only"` and the site says so.
Guessing is never permitted — an artifact with no provenance level fails lint.

**Decision 2 — items are immutable; suites grow by retirement, never by edit.** `tiltmeter lint`
compares each item's canonical bytes against the last published reading's suite and **fails on any
in-place edit**. Changing an item = retire it (kept in the file, shown on the site) + add a new id.
This is the anti-p-hacking mechanism: you cannot quietly delete the item the new model failed. It is
checkable in CI from git alone, which is the whole point — and CI actually runs it (`ci.yml`'s
`suite-lint` stage, `pnpm suite-lint` locally).

The baseline lint compares against is resolved in preference order: (1) the suite as it existed in
the commit that produced the `suiteSpecHash` pinned by the most recently *published reading* for that
suite (the same git walk `tiltmeter verify`'s pre-registration proof uses); (2) while no reading yet
references the suite (true on day one — `observatory/readings/` starts empty), the **previous commit**
that touched the suite file, walked via git log on that path. Never `HEAD` on its own: once an edit is
committed, `HEAD` and the working tree are identical, so a `HEAD`-vs-current comparison degenerates
into comparing a commit to itself and can only ever catch an edit still sitting *uncommitted* — not
the realistic threat model of a merged PR. A suite with no prior commit at all is a genuine first
publish (nothing to compare, a real pass, printed as such). Anything else that blocks resolving a
baseline that should exist — a historical revision that no longer parses under the current schema, a
reading whose pinned hash resolves to no commit — is a **failing** `immutability-baseline-unresolved`
issue, never a silent pass.

**Decision 3 — `suiteSpecHash` = sha256 of the canonicalized suite file with only `docs` excluded.**
Everything that can change behavior or scoring is inside the hash, including retirements and sampling
policy. Any suite edit therefore forces a **rebaseline run** (§4) and visibly breaks the chart line.
That cost is deliberate design pressure: editing your suite is not free and is never invisible.

### 3.2 Probe types and scorers (deterministic only)

| Probe | Question | Scorers |
|---|---|---|
| `activation` | does my skill/agent description still fire — and stay quiet on non-matches | `tool-called(name,args)`, `no-tool-called` |
| `tool-selection` | given N of my real tool schemas, does it still pick the right one | `tool-called`, `tool-in-set`, `arg-enum`, `arg-required-keys` |
| `instruction-adherence` | does my routing prompt still steer the sequence | `tool-order([a,b])`, `no-tool-called`, `literal-prefix` |
| `output-format` | is my downstream contract still satisfiable | `json-schema-valid(schemaRef)`, `arg-required-keys` |
| `refusal-shape` | does it still refuse *through my channel* rather than improvising | `tool-called("decline",{reason_code∈…})` vs `tool-called(action)` |

Scoring reads the **first `tool_use` block** (full list recorded; `tool-order` uses the list). Regex
scorers exist only for control tokens an instruction explicitly demands (`literal-prefix`), never for
prose semantics. **House rule printed in METHODOLOGY.md: a scorer that must interpret prose means the
probe is wrong.**

**Negatives mandatory:** lint fails a suite with `negatives < max(3, 20% of active items)`. Every suite
publishes `falsePositiveRate` as a first-class metric — a suite whose overall rate holds while its FPR
rises has regressed (the 80%-false-positive finding from `guilds/evals/README.md` is why).

**Sampling policy — k=3, temperature 1.0.** Not temperature 0: (a) production harnesses run at default
sampling, so t=0 measures a configuration nobody ships; (b) t=0 is not deterministic on provider infra
anyway, so it buys false confidence; (c) k repeats yield a per-item pass fraction and therefore a
*flakiness* signal, which t=0 hides. No seed parameter exists on the API — that irreducible
non-determinism is exactly why every run group carries a null pair (§4). k=5 on release-triggered runs.

### 3.3 Reading (one per cell) and the index

```jsonc
{ "formatVersion": 1, "runGroupId": "rg-20260815-1", "cellId": "sonnet5",
  "axes": { "suiteSpecHash": "…", "modelIdRequested": "claude-sonnet-5",
            "modelIdResolved": "claude-sonnet-5-2026xxxx", "aliasUsed": true,
            "runnerBehaviorVersion": 1, "presentationHash": "…", "samplingPolicyHash": "…" },
  "harnessCommit": "…", "runnerVersion": "1.0.0", "startedAt": "…", "finishedAt": "…",
  "status": "complete" | "partial" | "aborted" | "skipped",
  "completeness": { "expectedTrials": 330, "ok": 330, "error": 0, "noResult": 0 },
  "metrics": { "overall": 0.918, "triggerRate": 0.95, "falsePositiveRate": 0.083 },
  "items": [ { "id": "taste-1", "passes": 3, "k": 3, "trials": [
      { "attempt": 1, "outcome": "pass", "firstTool": "Skill", "args": {"skill":"taste"},
        "stopReason": "tool_use", "usage": {"in":1421,"out":54}, "batchCustomId": "…" } ] } ],
  "cost": { "estimatedUsd": 0.71, "actualUsd": 0.69, "pricingManifest": "pricing.2026-08-08.json",
            "mode": "batch" },
  "bodyHash": "sha256:…" }
```

`readings/index.json` is append-only and hash-chained: each entry `{runGroupId, at, harnessCommit,
runnerBehaviorVersion, cells[], status, costUsd, hash, prevHash}`. Canonical JSON everywhere: keys
sorted, 2-space indent, `\n`, trailing newline (matches snapgauge, so the whole program diffs the same).

**Integrity — decided: no self-generated signing key.** A key stored in Actions secrets proves nothing
an attacker with repo write could not forge. The load-bearing proof is **git history on a public repo**
plus the hash chain. On top of that, `publish.yml` runs `actions/attest-build-provenance` over the
readings bundle: Sigstore/OIDC binds the artifact to *that workflow, in that repo, at that commit* —
an identity James cannot mint by hand. `attestationId` is recorded in `run.json`. **Cut line:** if
attestation costs more than an afternoon, drop it; the chain + git history still carry the claim.

---

## 4. The attribution model (the director's edge case)

A **cell** is one (suite × model) execution. Its identity is the **axis tuple**:

```
axes = { suiteSpecHash, modelIdResolved, runnerBehaviorVersion, presentationHash, samplingPolicyHash }
```

A **run group** is one scheduled execution that fills *every* cell of `panel × suites` at the current
harness commit, in one window. **The run group is the control.** All model-to-model comparison happens
inside a run group; nothing is ever compared across a window in which two things moved.

**A comparison is computed only when exactly one axis element differs.** Three legal axes:

| Axis | What varies | Reads as |
|---|---|---|
| `model` | `modelIdResolved`, same run group | **the tilt** — did the new release move my harness |
| `time` | nothing varies, different run group | provider-side drift **and the published noise floor** |
| `harness` | `suiteSpecHash`, same run group | did *my* edit change behavior (rebaseline pair) |

Anything else → **`cannot-attribute`**, emitted as a first-class verdict with `reasons[]` naming every
axis element that co-varied. The director's edge case (harness edited *and* model changed) is not a
special case in the code — it falls out as `reasons: ["suiteSpecHash","modelIdResolved"]`. It is never
guessed, never silently dropped, and it renders on the site as a labelled break in the series.

**Rebaseline on harness change.** When `suiteSpecHash` changes, `tiltmeter plan` marks every existing
model cell for that suite as stale and schedules a rebaseline run group that re-runs the **whole panel**
on the new hash. Until that run group exists, `compare` refuses to cross the boundary. The chart
**refuses to draw a line across a suite change** — the visual expression of the same rule.

**Alias substitution.** Panel entries prefer dated snapshot ids. When only an alias exists, the runner
records `modelIdResolved` from the API response's `model` field. If a panel entry's resolved id changes
between run groups, that is itself published as a `provider-substitution` event and every comparison
across it is `cannot-attribute`.

**Null pair (mandatory).** Every run group runs the cheapest panel model **twice** as two distinct cells
(`haiku45`, `haiku45-null`), identical axes. It is the negative control at the reading level: the
measured same-model delta bounds what "moved" can mean that week. Cost ≈ $0.36/week; it is the single
thing that makes every positive claim credible, and it ships from day one.

---

## 5. Statistics and the drift taxonomy

Per item *i*, pass fraction `a_i = passes/k ∈ [0,1]`. Suite delta `D = mean_i(b_i) − mean_i(a_i)` per
declared metric (`overall`, `triggerRate` over positives, `falsePositiveRate` over negatives).

**Chosen bar: seeded paired percentile bootstrap over items, B = 10,000, 95% CI.** Resample *items*
(not trials) with replacement; the same item set runs on both sides, so pairing removes item-difficulty
variance and gives usable power at n = 30–60. Seed = first 8 hex of `sha256(bodyHashA + bodyHashB)` —
deterministic, reproducible, and not chosen by the analyst. Rejected alternatives, with reasons:
a binomial CI on the pooled trial count assumes independence that k repeats on one item plainly violate
(it would over-fire); a per-item exact test at k=3 is hopeless underpowered. The bootstrap also handles
fractional per-item scores without pretending they are Bernoulli draws.

| Verdict | Bar |
|---|---|
| `regressed` | 95% CI excludes 0, `D < 0`, and `|D| ≥ MDE` (default `1/n` = one item's worth) |
| `improved` | same with `D > 0` |
| `moved-within-noise` | CI includes 0, or `|D| < MDE` |
| `cannot-attribute` | >1 axis varied · missing cell · either reading `partial`/`aborted` |

A suite's verdict is the **worst** of its declared metrics. Per-item labels — `held` / `broke` (k/k → 0/k)
/ `fixed` / `flaky` (mixed within either reading) — are **descriptive, not inferential**; flaky items are
excluded from `D` and reported separately, and METHODOLOGY.md states plainly that at k=3 no item-level
claim carries a confidence interval. The inference lives at the suite level; the *story* is the item list.

---

## 6. Module / boundary map

```
   suites + presentations ──▶ core/suite ──▶ core/presentation ──▶ RequestPlan[]
                                                     │
   client/anthropic (batch | sync | count_tokens) ◀───┤  ← the ONLY network boundary
   testing/FakeModelClient ◀──────────────────────────┘     (injected; identical interface)
                                                     ▼
   raw responses ──▶ core/scorers ──▶ core/reading ──▶ canonical JSON ──▶ observatory/readings/
                                                     │
   readings ──▶ core/compare (axes) ──▶ core/stats (bootstrap) ──▶ Comparison ──▶ apps/web (build time)
```

**Isolation.** `core/` never imports `node:*`, never opens a socket, never reads env — it is pure and
runs identically in the CLI, in CI, and (unused at v1, but free) in a browser. `client/` is the single
place that spends money and is swappable for `FakeModelClient`, which is what makes the entire eval
suite cost $0. `apps/web` imports `core/compare` + `core/stats` and reads committed JSON at build time;
it has no runtime dependency on the client and **no API routes at all**.

---

## 7. API surface

### CLI (`tiltmeter`, npm name to re-verify at publish)

| Command | Spends? | Does |
|---|---|---|
| `tiltmeter init --from-skills <dir> \| --from-mcp <tools.json> \| --from-snapgauge <snap.json>` | no | scaffolds a suite from real artifacts (snapgauge snapshots carry tool schemas — free interop) |
| `tiltmeter lint [suite]` | no | schema, negatives quota, item immutability vs git, provenance level, maxTokens headroom |
| `tiltmeter plan --panel panel.json [--offline]` | no | builds the run matrix, **exact** cost estimate via `count_tokens` (free endpoint, per model — so the 4.7+ tokenizer inflation is *measured*, not guessed), checks caps, writes `plan.json`. `--offline` falls back to the manifest's `estimateMultiplier` and marks the estimate `approximate` |
| `tiltmeter run --plan plan.json [--batch\|--sync] [--resume <rg>]` | **yes** | executes, writes readings + `run.json` |
| `tiltmeter compare <a> <b>` | no | axis check → verdict (pure, offline) |
| `tiltmeter report <runGroupId> [--format md\|json]` | no | reproduces the published summary |
| `tiltmeter verify [--since <commit>]` | no | body hashes, index chain, artifact provenance, **pre-registration proof** |

**BYOK.** `ANTHROPIC_API_KEY` from env only — never a flag (shell history), never written to disk,
never sent anywhere but `api.anthropic.com`. The site has no key field and no server.

**Pre-registration proof, made verifiable to a skeptic (`tiltmeter verify`).** For each reading it
(1) recomputes `suiteSpecHash` from the suite file, (2) walks git history for the first commit whose
tree contains that hash, (3) reads `models.json` for the model's `releasedAt` **plus a cited source
URL**, and (4) asserts `suiteRegisteredAt < modelReleasedAt`, printing the commit SHA and both dates.
The site's reading page renders the same three facts with a GitHub permalink. Git history is the proof;
the command just makes checking it a 30-second job.

**Presentation (`presentations/skill-tool@1.json`).** A committed template: system-block layout, how an
artifact of each `kind` is rendered (a `skill-description` becomes an entry in a `Skill` tool's enum,
mirroring Claude Code's real shape; a `tool-schema` becomes a `tools[]` entry verbatim), tool_choice
policy, and stop conditions. Hashed into the axis tuple. Changing it invalidates comparison — deliberately.

**Site routes (all statically prerendered, `export const dynamic = 'error'` on every one).**
`/` · `/readings/<runGroupId>` · `/suites/<id>` · `/models` · `/methodology`. Zero API routes, zero DB,
zero writes → the §4.2 "no unauthenticated write path" bar is met structurally, D3 is met by construction.

---

## 8. Run economics, caps, and schedule

**Panel policy.** Standing panel = the models James actually routes to: **Haiku 4.5 + Sonnet 5**, plus
the Haiku null cell. Release-triggered runs use standing panel **+ the newly released model** at k=5 —
because "did the new release move my harness" requires the new model *and* a same-window incumbent.
No standing Opus/Fable (feasibility §6 rule); they appear on their own release run only.

**Cost model** (feasibility §6 rates, Batch −50%, ~110 items × k=3 = 330 trials/cell, measured
~1,700 in / ~100 out per trial; **budget assumes zero prompt-cache hits — any hit is upside**):

| Cell | Batch rate | Per reading |
|---|---|---|
| Haiku 4.5 | 0.50 / 2.50 | **$0.36** |
| Haiku 4.5 (null) | 0.50 / 2.50 | **$0.36** |
| Sonnet 5 (intro → 2026-08-31) | 1.00 / 5.00 | **$0.73** → **$1.09** after |
| Weekly run group | | **$1.45** → **$1.81** after 2026-08-31 |
| Monthly (4 weekly + ~1 release run at k=5) | | **≈ $8.2 → $9.6** |
| Opus 5 on its release run (k=5) | 2.50 / 12.50 | +$3.6 |
| Fable 5 on its release run (k=5, +30% tokens measured by `count_tokens`) | 5.00 / 25.00 | +$9.4 |

**Hard caps, two layers.** (1) **Provider-enforced:** a dedicated Anthropic API key in its own workspace
with a **$20/month spend limit set in the console** — the only cap that survives a leaked key.
(2) **Runner-enforced:** `maxRunUsd` = 3.00, `maxCellUsd` = 1.50, `maxMonthUsd` = 15.00 tracked in
`readings/index.json` (month-to-date is a committed number, not a guess). `plan` refuses to emit a plan
that exceeds any cap; `run` re-checks against **actual** usage after each cell and, on breach, stops
submitting, writes the reading as `aborted` with `abortedBy: "cap"`, and commits. Never a silent skip.

**Schedule (D4 — GitHub Actions, never Vercel cron).**
- `reading.yml` — `schedule: '0 3 * * 1'` (weekly) + `workflow_dispatch`.
- `release-watch.yml` — daily; diffs the Anthropic models list against `models.json`, opens a PR adding
  the new model with its `releasedAt` + source URL. **The PR is the human gate**; merging it triggers a
  release run. No model enters the panel automatically.
- `health.yml` — daily; fails loudly and opens an issue if the newest reading is >14 days old.
- **60-day auto-disable mitigation:** every weekly run commits something *even when it does nothing* —
  a `status: "skipped"` record with the reason (no key, cap reached, no changes) is still a commit, so
  repo activity never lapses. The health job is the backstop, and the site's dead-man banner (>10 days)
  is the public-facing honesty: a stale observatory says it is stale rather than implying currency.

**Cheaper fallback if James wants ~$4/mo:** biweekly cadence, Haiku-only standing panel, Sonnet on
release runs only. Recorded here so it is a config change, not a redesign.

---

## 9. Failure contracts (the ugly paths)

| Situation | Contract |
|---|---|
| 429 / 529 / transient 5xx | full-jitter backoff, ≤3 attempts, `Retry-After` honoured; then the **trial** is `noResult` — never scored as a fail |
| Truncated response (`max_tokens`) | `noResult` with reason; lint requires `maxTokens ≥ 4×` the largest expected output so this stays rare |
| Any `noResult > 0` | reading `status: "partial"`; **denominator is always `items × k`** — missing trials are never dropped (dropping them biases the rate). A partial reading is excluded from every aggregate comparison → `cannot-attribute(incomplete)`. Per-item detail is still published |
| Crash / cancelled workflow after batch submit | Deterministic `custom_id = sha256(runGroup,suite,item,trial)` is persisted to `run.json` as a `status: "pending"` record **before** `submitBatch` is called (not merely computed in memory and written afterward). A cell with a recorded `batchId` refuses a new submission — the duplicate-spend guard `run --resume` checks first. A cell left `pending` with **no** `batchId` by an interrupted prior process is genuinely ambiguous (no client-supplied idempotency key exists on the provider's Batch API to ask "did you already receive this?") — `--resume` refuses to guess and exits `RESUME_AMBIGUOUS` (`E_AMBIGUOUS_PENDING_BATCH`) naming the exact `custom_id`s to check on the Anthropic console, rather than silently resubmitting |
| Batch expires (24h) / partially fails | expired requests → `noResult`; one retry of only the failed `custom_id` set within the same run group, recorded as `attempt: 2` |
| Cap tripped mid-run | stop submitting, write `aborted`, commit, banner on the site. Never silent |
| Model id 404 / retired | cell `unavailable`, run continues, comparisons touching it → `cannot-attribute` |
| Alias resolved to a different snapshot | `provider-substitution` event; comparisons across it → `cannot-attribute` |
| API key missing/invalid | exits **before** spending, writes `skipped` with reason, commits (keeps the repo active) |
| Suite edited between plan and run | `plan.json` pins `suiteSpecHash`; mismatch → exit 4, "re-plan" |
| Fork PR / external contributor | `reading.yml` is `schedule` + `workflow_dispatch` only, guarded by `if: github.repository == 'jamessuuu/tiltmeter'`, `permissions: contents:write` and nothing else. **No workflow reachable by external input ever sees `ANTHROPIC_API_KEY`.** Stated in SECURITY.md |
| Hobby blackout / every function paused | the site is 100% static; nothing to pause. `/` still renders (D3) |
| Site build grows unbounded | last 52 run groups prerendered in full; older link to raw JSON on GitHub |

**Cost safety (D2), both abuse numbers.** (a) Public traffic: **$0 model spend at any volume** — there
is no request path to a model. Metered exposure is edge requests only; the one Hobby WAF rate-limit
rule is bound to `/*` (documented in SECURITY.md) and the worst case is a 30-day pause of a static site
whose every claim is reproducible from the repo. (b) The key: bounded by the console workspace limit
($20/mo, provider-enforced) *and* the runner caps ($3/run, $15/mo). Fallback on any trip is publishing
a `skipped`/`aborted` record, never a 500 and never a quiet gap.

---

## 10. The site (`apps/web`)

Next.js 16.3 App Router / React 19.2 / TS strict + `noUncheckedIndexedAccess` / Tailwind 4, fully
prerendered at build from `observatory/`. Vercel git integration rebuilds on the reading commit; the
Actions job also pings a deploy hook as a fallback.

- **`/`** — the instrument: per suite, one line per model across run groups, with **hard breaks at every
  `suiteSpecHash` change** (annotated "suite rebaselined — series restarts") and a shaded band showing
  the measured **null-pair noise floor**. Headline sentence is always a delta about the harness, e.g.
  *"house-skill-activation, harness `a1b2c3d`: Sonnet 5 → Sonnet 5.1, overall −8.2pp (CI −13.1…−3.4) —
  regressed; 4 items broke."* Dead-man banner when the newest reading is >10 days old. Renders with JS
  disabled.
- **`/readings/<rg>`** — every cell, completeness, **actual USD cost**, per-item table with
  held/broke/fixed/flaky, the pre-registration triple (suite registered / model released / reading taken)
  with GitHub permalinks, the exact `tiltmeter` command to reproduce, and a raw-JSON link.
- **`/suites/<id>`** — items including retired ones with retirement reasons, artifact provenance levels,
  registration dates, current `suiteSpecHash`.
- **`/models`** — panel entries, `releasedAt` with cited source, resolved snapshot ids, substitutions.
  **No ranking, no scores, no leaderboard** — the death-condition guard, and a design-review checklist item.
- **`/methodology`** — presentation templates, scorers, k/temperature and why not 0, the axis rules,
  the bootstrap and its bar, the noise floor, cost policy, and **Limitations** (§13).
- **`/docs`** — added in the design/documentation pass after M8: install, a five-minute no-key quickstart
  (`init --from-skills` → `lint` → `plan --offline`), the attribution model with the mechanism diagram
  (`scripts/diagram.mjs`, CI-drift-checked like `scripts/brand.mjs`), the statistics, item immutability,
  the cost model, the secret boundary, failure modes, and limitations — written for a reader who has never
  seen this project. `/` and `/docs` both embed the same diagram component (`components/AttributionDiagram.tsx`).

---

## 11. Launch suites and honest claim sizing

| Suite | Real artifacts | Items | Probes |
|---|---|---|---|
| `house-skill-activation` | 10 real `SKILL.md` `description` fields from `~/.claude/skills` (taste, retro, save, scout, pulse, hub, inbox, launch, new-project, new-guild) — the port of `guilds/evals/trigger` | 20 pos + 12 neg = **32** | `activation` |
| `mcp-tool-selection` | real tool schemas from configured MCP servers (context7 `resolve-library-id` vs `get-library-docs`, github, playwright/agent-browser) incl. **confusable pairs** | 20 pos + 8 neg = **28** | `tool-selection` |
| `routing-adherence` | the worlds router + routing-discipline block from `CLAUDE.md`, presented with `route(world)` / `split_task()` tools | 16 pos + 6 neg = **22** | `instruction-adherence` |
| `output-contract` | the ecosystem's artifact vocabulary (Verdict/Finding shapes) + a `decline(reason_code)` channel | 18 pos + 8 neg = **26** | `output-format`, `refusal-shape` |

**≈108 active items, ≥31% negatives.** The trigger-suite port is checked once against the live
`run.mjs` CLI path at launch (do both fire the same skills on the same 26 prompts?) and the agreement
number is published as a fidelity note — it is evidence about the presentation, not a claim of equivalence.

**Honest launch claim.** README and `/` say, in these words: *"tiltmeter launched 2026-08-XX with 4
pre-registered suites and 108 items. There is no time series yet — that is what pre-registration means.
The series starts here."* Day-one content without faking history: (1) the launch run group's **within-group
model comparison** (Haiku 4.5 vs Sonnet 5 on the same pinned suites — a real, useful reading for anyone
who routes between them), and (2) the **null-pair noise floor**. Explicitly not claimed: that these
suites represent anyone else's harness (they are James's), or that any number here says anything about
a model's capability.

---

## 12. Eval / golden set — CI stage 5, $0, deterministic

`evals/` runs entirely on fixture readings and `FakeModelClient`. No network, no key, every PR.

**Classifier goldens (≥24 cases, 100% exact-match required).**
- **positive** — 12 of 40 items flipped k/k→0/k ⇒ `regressed`, CI excludes 0, exactly those 12 listed as `broke`.
- **negative** — byte-identical readings, different run group ⇒ `moved-within-noise`, **must not fire**.
- **negative (near-miss)** — 1 item of 40 flipped ⇒ `moved-within-noise` (below MDE). False-positive discipline.
- **edge (the director's case)** — suite edited **and** model changed ⇒ `cannot-attribute`,
  `reasons == ["modelIdResolved","suiteSpecHash"]`, and **no delta number is emitted at all**.
- **edge** — partial reading (3 `noResult`) ⇒ `cannot-attribute(incomplete)`.
- **edge** — flaky items (2/3 both sides) ⇒ excluded from `D`, listed as flaky, verdict unchanged.
- **edge** — alias substitution ⇒ `cannot-attribute(provider-substitution)`.
- **edge** — same axes, different run group ⇒ classified on the `time` axis, labelled provider-side.
- **improved**, and **FPR-only regression** (overall flat, negatives degrade ⇒ suite `regressed`).

**Calibration gates (seeded simulation, the numbers that go in the README).**
- 200 null pairs drawn from identical per-item rates ⇒ **false-positive rate ≤ 5%** (CI fails at >8/200).
- 200 pairs with a planted 20% degradation on 40 items ⇒ **detected ≥ 90%** (power floor).

**Runner unit tests (FakeModelClient).** Scorers per probe type incl. multi-tool responses and
truncation; batch `custom_id` determinism and the no-double-submit guard; `--resume` reconstructs a
reading from committed batch ids without spending; cap-abort writes `aborted` and commits; partial-write
denominators; cost math against the dated manifest (asserts the Sonnet 5 price change on 2026-08-31
selects the right row, and that `count_tokens` results — not a multiplier — drive a Fable-5 estimate);
canonical JSON is byte-stable on re-serialization; `verify` passes on the committed corpus and fails on
a tampered byte.

**Live smoke** — `workflow_dispatch` only: `--sync --limit 2 --model claude-haiku-4-5`, ≈$0.002. Never on PRs.

**CI (D6, five stages):** `typecheck → lint → unit → e2e:smoke → eval`, plus `tiltmeter lint` on every
suite (immutability + negatives quota) and `tiltmeter verify` on the readings corpus.

---

## 13. Acceptance criteria

**Death-condition guard.** ☐ No cross-suite model aggregate exists in the schema, the CLI output, or
any page ☐ no ranking/leaderboard UI ☐ every published number carries suite + harness commit + model
☐ README states the harness-behavior framing in the first paragraph.

**Feasibility §4.2 bar.** ☐ Zod at every boundary (suite files, readings, API responses before
interpretation, site build inputs) ☐ **no unauthenticated write path — there is no write path**
☐ WAF rule bound and documented ☐ cost ceiling with fallback: console workspace limit + runner caps +
`skipped`/`aborted` records ☐ typed error taxonomy (`E_CAP`, `E_PLAN_STALE`, `E_AXIS_CONFLICT`,
`E_PARTIAL`, `E_PROVENANCE`, `E_IMMUTABLE_ITEM`, `E_PROVIDER`, `E_AMBIGUOUS_PENDING_BATCH`), no provider
strings echoed ☐ self-persisted
observability = the committed run logs (Hobby keeps runtime logs 1 hour; tiltmeter keeps them forever
in git) ☐ no DB, and the reason stated ☐ **README failure-mode table** (§9) ☐ SECURITY.md covering
BYOK handling, the fork-PR secret boundary, and the reverse threat: **suites vendor your artifact text —
review before committing a suite built from a private harness**.

**Product.** ☐ `cannot-attribute` is a first-class published verdict with reasons ☐ null pair in every
run group ☐ partial readings never enter an aggregate ☐ `--resume` proven to not double-spend ☐ chart
breaks at every rebaseline ☐ calibration numbers (FPR ≤5%, power ≥90%) in the README, regenerated by CI
☐ **Limitations** section: presentation ≠ your runtime; no seed exists on the API; k=3 is
suite-level-inferential only; aliases can be substituted; Anthropic-only panel; batch results may lag a
release by up to 24h; the suites are James's harness.

**Brand (BRAND-KIT).** ☐ `public/brand/` chip-mark set ☐ 16px chip-mark favicon ☐ footer on every page
(chip mark + "Built by James Lorenz Santos" + agentjames.vercel.app + repo link) ☐ **no hire-me CTA (D1)**
☐ README lockup header + "Part of the Agent James portfolio" ☐ deterministic `scripts/brand.mjs`
generating the **tiltmeter glyph: a plumb line hanging from a fixed datum — the vertical datum and
frame in ink, the bob deflected off-axis with its deflection arc in the one amber accent**, 64px grid,
no `Math.random`, no webfont ☐ build-time OG image in PAPER/INK/AMBER ☐ MIT with the `public/brand`
carve-out.

---

## 14. Build order (each milestone ends on a green five-stage CI commit)

| M | Deliverable | Green gate |
|---|---|---|
| **M0** | Workspace, TS strict + `noUncheckedIndexedAccess`, ESLint 9, Vitest 4, Playwright, 5-stage CI, brand assets, SECURITY.md, static `/` deployed | CI green; `/` live on Vercel |
| **M1** | **WALKING SKELETON:** suite schema + Zod types + canonical writer, `presentation@1`, three scorers, `FakeModelClient`, `run` writes one reading, `compare` emits a verdict — **all offline, $0** | A planted regression in a fixture pair classifies `regressed`; identical pair classifies `moved-within-noise`. Publishable as `0.1.0-alpha` |
| **M2** | Attribution: axis tuple, run groups, `cannot-attribute` with reasons, rebaseline detection, index + hash chain, `verify` | The 8 edge goldens pass, incl. harness-edited-and-model-changed |
| **M3** | Statistics: seeded paired bootstrap, MDE, per-metric verdicts, item labels; calibration sims | FPR ≤5%/200, power ≥90%/200; numbers injected into README with a CI drift check |
| **M4** | Real client: batch + sync, `count_tokens` planning, pricing manifest, caps, `custom_id`, `--resume`, partial/abort policy, error taxonomy | Fake-client tests for every §9 row; live smoke on dispatch costs <$0.01 |
| **M5** | Observatory: 4 suites authored from real artifacts, `lint` (negatives quota + item immutability vs git), `models.json` with cited release dates, `panel.json`, **first real run group committed** | `tiltmeter verify` green on the corpus; the Haiku↔Sonnet comparison and the null-pair noise floor publish |
| **M6** | Site: `/`, `/readings/<rg>`, `/suites/<id>`, `/models`, `/methodology`; dead-man banner; brand + OG + glyph; WAF rule | Playwright smoke; renders with JS disabled; `dynamic='error'` on every route; banner unit-tested at the 10-day boundary |
| **M7** | Workflows: `reading.yml` (weekly + skipped-record commits), `release-watch.yml` (PR-gated model additions), `health.yml`, deploy hook; attestation in `publish.yml` | A dispatched run completes end-to-end and commits; a simulated cap trip commits an `aborted` reading |
| **M8** | `tiltmeter@1.0.0` publish with `--provenance`, `init --from-skills/--from-mcp/--from-snapgauge`, README + Limitations, portfolio entry | `npx tiltmeter@1 init` + `lint` + `plan --offline` works from a clean clone with no key |

**Cut line if the program slips:** M0–M5 plus a static `/` is a complete, honest, publishable flagship —
the runner, the attribution model, the statistics, and one real reading. M6–M8 are amplification.
**Never cut M2 or M3** — the attribution model and the calibrated classifier *are* the project.

---

## 15. Open questions (deferred to the main session / James)

1. **Anthropic workspace monthly spend limit** — confirm the console supports a per-workspace monthly
   cap on the Max/API account; if not, fall back to a dedicated low-limit key + billing alert and say so
   in SECURITY.md. *(Blocks M7, not earlier.)*
2. **npm `tiltmeter` + `tiltmeter.vercel.app` availability at publish time** — naming.md's check is from
   2026-08-08; fallback `@jamessuuu/tiltmeter` and `tiltmeter-dev.vercel.app`.
3. **MCP tool schemas in `mcp-tool-selection`** — vendoring third-party open-source tool definitions with
   attribution is the plan; James's call on which servers appear publicly (context7/github/playwright
   are public; nothing from any private employer or client world may ever appear).
4. **Cadence and budget sign-off** — weekly at ~$8–10/mo (the spec's default) vs the ~$4/mo fallback
   (biweekly, Haiku standing). This is the feasibility §5.C YELLOW decision and it is James's, not the
   architect's.
5. **Batch results retention window** — treated as "download and commit immediately"; confirm the exact
   provider retention at M4 so `--resume` documents a real deadline.
6. **`actions/attest-build-provenance` on readings** — include if it costs under an afternoon; the hash
   chain + git history is the load-bearing proof either way (M7 cut line).
7. **A second harness presentation** (e.g., an `agent-description` kind for subagent charters) — deferred
   past v1; adding one is a new `presentationHash`, which by design restarts affected series.
