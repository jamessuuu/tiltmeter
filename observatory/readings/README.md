# readings/ — empty by design

This directory is intentionally empty. Four suites, one panel, and a pricing
manifest are pre-registered as of this commit — the first real run group
that spends money against them has **not** happened yet.

**Why it's empty, on purpose (SPEC §14 M5):** M5's job is authoring the
observatory's data — the suites, the panel, the pricing manifest, the model
release dates — and wiring `tiltmeter lint`/`tiltmeter verify` to check them.
It is explicitly **not** M5's job to spend James's money or use his API key.
`tiltmeter plan --offline` and `tiltmeter run` both work today (proven in
`packages/tiltmeter/src/cli/commands/plan-run.test.ts` and
`run-orchestrator.test.ts`, entirely against a `FakeModelClient`, $0) — the
first REAL run group is a deliberate, James-gated step, not an automated one.

**What "empty" means structurally.** `tiltmeter verify` and `tiltmeter run
--resume` both already handle this directory containing nothing: `verify`
reports "no readings corpus found… nothing to verify yet" and "no readings to
check yet" rather than a false pass; there is no `index.json` yet either
(`readings/index.json` is created by the first entry `tiltmeter run` ever
appends — SPEC §3.3's append-only hash chain starts at its first real
commit, not before).

**What happens when the first run group lands.** `tiltmeter plan --run-group
<id>` writes `readings/<id>/plan.json`; `tiltmeter run --plan <id>` writes
`readings/<id>/run.json` plus one `<suiteId>__<cellId>.json` reading per
cell, and appends one entry to `readings/index.json`. From that point on this
README is stale and should be deleted in the same commit that adds the first
real reading — its only job is to make the current, honest state legible
instead of leaving an empty directory to speak for itself.

See `docs/SPEC.md` §8 (run economics, the two cap layers, the schedule) and
§11 (the four launch suites and the honest launch claim this repo makes on
day one: *"There is no time series yet — that is what pre-registration
means. The series starts here."*).
