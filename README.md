# tiltmeter

**tiltmeter tells an operator when a new model release moves *their* agent
harness off true — not how capable a model is in the abstract, but whether a
specific skill description, tool schema, routing prompt, or output contract
still fires the way it did last week.** The unit of measurement is a harness
artifact, pinned to a commit and probed with deterministic scorers; every
published number is scoped to `(suite, harness commit, model)`, never to a
model alone.

> **Status: pre-release scaffold (M0).** The API in [docs/SPEC.md](docs/SPEC.md)
> is designed and frozen for v1; implementation is landing milestone by
> milestone. Nothing below claims to work until its milestone's tests say
> so — this README grows only as fast as the receipts do.

## Why

Every agent harness is full of small, load-bearing artifacts: the sentence
that decides whether a skill fires, the tool schema an agent chooses between,
the prompt that steers a routing decision, the shape a downstream consumer
requires back. A model release can move any of these without moving any
capability benchmark at all — and "capability benchmark" is not what a
harness operator actually needs to know. tiltmeter probes your *own*
artifacts, deterministically, and tells you when they moved:

- **A pre-registered suite** — your artifacts, vendored and hashed
  (`suiteSpecHash`), so a suite edit is never invisible and never quietly
  changes what "regressed" means.
- **The attribution model** — a comparison is computed only when exactly one
  axis (model, time, or your own harness edit) varies between two readings.
  Everything else is `cannot-attribute`, published with `reasons[]`, never
  guessed.
- **A calibrated classifier, not a vibe** — a seeded paired bootstrap over
  items, with a measured false-positive rate and detection power, not a
  threshold picked by eye.
- **Zero LLM judges, anywhere.** If a probe cannot be scored deterministically,
  the probe is wrong — the probe gets fixed, not the judge added.

## Non-goals (hard guards — refusals, not backlog)

1. **No capability benchmarking.** No metric about a model in isolation,
   ever. No page ranks models. This is the project's death condition —
   enforced structurally, not by convention.
2. **No LLM judge anywhere** — not in the gate, not as a diagnostic tier.
3. **No visitor-triggered compute.** No API routes, no database, no key
   input field, no hosted run path.
4. **Not an agent-runtime driver.** tiltmeter presents your artifacts through
   a declared presentation over the Messages API; it does not drive Claude
   Code, your CLI, or your production loop.
5. **No cross-vendor panel at v1.** Anthropic first-party only.

See [docs/SPEC.md](docs/SPEC.md) §1 for the full guard list and §13 for the
acceptance criteria that keep them true.

## Package

| Package | Purpose |
|---|---|
| `tiltmeter` | The only published package — core (suite/presentation/scorers/reading/compare/stats), the Anthropic client, and the CLI. `"."` is the isomorphic programmatic API; `"./testing"` is `FakeModelClient` + fixture builders, which is what makes the eval suite cost $0. |

`observatory/` (James's own instance — suites, presentations, readings) is
data and config only, zero code, so a fork replaces it and keeps everything
else (docs/SPEC.md §2). `apps/web` (the static site rendering the time
series) is **deferred past M0–M3** — deploys on this machine are James-gated
program-wide, and there is nothing to deploy until the runner and the
attribution model it is built on land first.

## Build order

`docs/SPEC.md` §14 is the source of truth; this table tracks status only.

| M | Deliverable | Status |
|---|---|---|
| M0 | Workspace, TS strict, ESLint 9, Vitest 4, 5-stage CI, LICENSE, SECURITY.md | done |
| M1 | Walking skeleton: suite schema, `skill-tool@1` presentation, 3 scorers, `FakeModelClient`, `run`, `compare` (mean delta) | done |
| M2 | Attribution: axis tuple, run groups, `cannot-attribute`, rebaseline, hash-chained index, `verify` | done |
| M3 | Statistics: seeded paired bootstrap, MDE, per-metric verdicts, calibration sims | not started |
| M4–M8 | Real client, the observatory's own suites, the site, scheduled workflows, npm publish | not started |

## Non-goals for this package specifically

No domain logic beyond the harness-drift measurement itself. No hosted run
path, ever (see Non-goals above). No telemetry.

---

Part of the [Agent James](https://agentjames.vercel.app) portfolio.
Built by James Lorenz Santos. Code MIT; brand assets excluded (see LICENSE).
