import type { Metadata } from "next";
import Link from "next/link";
import { AttributionDiagram } from "@/components/AttributionDiagram";

export const dynamic = "error";

export const metadata: Metadata = { title: "Docs" };

const SECTIONS = [
  { id: "install", label: "Install" },
  { id: "quickstart", label: "Five-minute quickstart" },
  { id: "attribution", label: "The attribution model" },
  { id: "statistics", label: "The statistics" },
  { id: "immutability", label: "Item immutability" },
  { id: "cost", label: "Cost model" },
  { id: "secrets", label: "The secret boundary" },
  { id: "failure-modes", label: "Failure modes" },
  { id: "limitations", label: "Limitations" },
];

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 prose-content">
      <h1 className="text-2xl font-semibold tracking-tight">Docs</h1>
      <p className="mt-2 text-ink/70 max-w-prose">
        Everything below is written for someone who has never seen this project. See also{" "}
        <Link href="/methodology" className="underline hover:text-amber">
          methodology
        </Link>{" "}
        for the scorer catalog and presentation templates.
      </p>

      <nav aria-label="Sections" className="mt-6 border hairline p-4 bg-white/40">
        <ul className="text-sm space-y-1">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline hover:text-amber">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <h2 id="install" className="mt-10 font-semibold scroll-mt-6">
        Install
      </h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        The package is <code>tiltmeter</code> on npm, run through <code>npx</code> so there is nothing to
        install globally:
      </p>
      <pre className="mt-3 border hairline bg-white/40 p-3 text-sm overflow-x-auto">
        <code>npx tiltmeter@1 --help</code>
      </pre>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        <code>init</code>, <code>lint</code>, <code>plan --offline</code>, and <code>verify</code> all work
        with no <code>ANTHROPIC_API_KEY</code> and no network — proven against the packed npm tarball
        installed fresh into an empty directory, not just inside this monorepo.
      </p>

      <h2 id="quickstart" className="mt-10 font-semibold scroll-mt-6">
        Five-minute quickstart
      </h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        No API key for any of this. It scaffolds a suite from a real directory of skill descriptions, checks
        it, and produces a cost estimate for running it — the exact trio a stranger can run cold.
      </p>
      <ol className="mt-3 text-sm text-ink/80 list-decimal pl-5 space-y-4">
        <li>
          <p>
            Point <code>init</code> at a directory of <code>&lt;skill-name&gt;/SKILL.md</code> files (the
            Claude Code skills convention — any directory with that shape works, including a small test one
            you write by hand):
          </p>
          <pre className="mt-2 border hairline bg-white/40 p-3 overflow-x-auto">
            <code>npx tiltmeter@1 init --from-skills ./skills</code>
          </pre>
          <p className="mt-2 text-ink/70">
            Writes a suite file under <code>observatory/suites/</code> with one <code>TODO</code>-scenario
            item per skill description found, plus a panel and pricing manifest if you don&apos;t already
            have one.
          </p>
        </li>
        <li>
          <p>Check the scaffold — schema, the negatives quota, provenance, token headroom:</p>
          <pre className="mt-2 border hairline bg-white/40 p-3 overflow-x-auto">
            <code>npx tiltmeter@1 lint</code>
          </pre>
          <p className="mt-2 text-ink/70">
            Fails loudly on a suite with too few negatives or an item missing its source provenance — both
            are deliberate, not warnings.
          </p>
        </li>
        <li>
          <p>Build the run matrix and get an exact cost estimate without spending anything:</p>
          <pre className="mt-2 border hairline bg-white/40 p-3 overflow-x-auto">
            <code>npx tiltmeter@1 plan --run-group demo-1 --offline</code>
          </pre>
          <p className="mt-2 text-ink/70">
            <code>--offline</code> falls back to a heuristic multiplier instead of calling the (free){" "}
            <code>count_tokens</code> endpoint, and marks the resulting estimate <code>approximate</code> so
            it is never confused with a real one.
          </p>
        </li>
      </ol>
      <p className="mt-4 text-sm text-ink/80 max-w-prose">
        Replacing the <code>TODO</code> scenarios <code>init</code> wrote with real ones, then running{" "}
        <code>tiltmeter run --plan demo-1</code>, is the only step in this whole quickstart that spends
        money — and it is a separate, explicit command, never something <code>plan</code> or <code>lint</code>{" "}
        does on your behalf.
      </p>

      <h2 id="attribution" className="mt-10 font-semibold scroll-mt-6">
        The attribution model
      </h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Every reading carries an axis tuple — five hashes identifying which suite, which model, which runner
        behavior, which presentation template, and which sampling policy produced it. Two readings are
        compared only when exactly one of those five differs. Model differing (same run group) reads as the
        tilt this project is named for; nothing else differing, across run groups, reads as the published
        noise floor; a suite hash differing (same run group) reads as a rebaseline, your own harness edit
        checked against itself.
      </p>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Anything else — most commonly a harness edit landing in the same window as a model release — is{" "}
        <code>cannot-attribute</code>, published with the exact axis names that co-varied. It is never
        guessed and never silently dropped; the chart draws a labelled break instead of a line.
      </p>
      <AttributionDiagram />

      <h2 id="statistics" className="mt-10 font-semibold scroll-mt-6">
        The statistics
      </h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Each item has a pass fraction (passes out of <code>k</code> repeats). A suite&apos;s delta is the
        mean pass-fraction difference between two readings, computed with a seeded paired percentile
        bootstrap over items — <strong>items</strong>, not trials, resampled together on both sides so that
        item-difficulty variance cancels out. The seed is the first eight hex characters of a hash of both
        readings&apos; body hashes, so a rerun of the same comparison always draws the same resamples; nobody
        picks it by hand. A verdict of <code>regressed</code> or <code>improved</code> requires both a 95%
        confidence interval that excludes zero and a delta at least as large as the minimum detectable
        effect (one item&apos;s worth, by default). Anything smaller is <code>moved-within-noise</code>.
      </p>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Sampling runs at <code>k=3</code> repeats, temperature 1.0 — not temperature 0. Production harnesses
        run at default sampling, so temperature 0 measures a configuration nobody ships. Temperature 0 is
        also not deterministic on provider infrastructure, so it would buy false confidence rather than real
        reproducibility. And <code>k</code> repeats at temperature 1.0 produce a per-item pass fraction — a
        flakiness signal that temperature 0 hides entirely, since it always resamples the same single
        trajectory. There is no seed parameter on the Messages API; that irreducible non-determinism is why
        every run group also carries a null pair (below).
      </p>

      <h2 id="immutability" className="mt-10 font-semibold scroll-mt-6">
        Item immutability
      </h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        A suite&apos;s items cannot be edited in place. <code>tiltmeter lint</code> compares each item&apos;s
        canonical bytes against the version last published in a reading, or against the previous commit that
        touched the suite file when no reading references it yet, and fails on any in-place change. Changing
        an item means retiring it — it stays in the file, visible on the site — and adding a new one with a
        new id.
      </p>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        This is deliberate friction: it is the anti-p-hacking mechanism. Nobody can quietly delete the item a
        new model failed and call the suite unchanged, because the check runs from git history alone in CI,
        not from anyone&apos;s memory of what the suite used to contain.
      </p>

      <h2 id="cost" className="mt-10 font-semibold scroll-mt-6">
        Cost model
      </h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Two independent cap layers. A provider-enforced monthly spend limit, set on a dedicated Anthropic API
        key in its own console workspace — the only cap that still holds if the key itself leaks, because it
        is enforced by Anthropic&apos;s infrastructure rather than this repo&apos;s code. And a
        runner-enforced set of caps tracked from the committed readings index:{" "}
        <code>maxRunUsd = $3.00</code>, <code>maxCellUsd = $1.50</code>, <code>maxMonthUsd = $15.00</code>.
      </p>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        <code>plan</code> refuses to emit a plan that would exceed any cap. <code>run</code> re-checks
        against actual spend after every cell and, on a breach, stops submitting, writes the reading as{" "}
        <code>aborted</code>, and commits that fact — never a silent skip. Batch API submission, at half the
        synchronous rate, is the default mode.
      </p>

      <h2 id="secrets" className="mt-10 font-semibold scroll-mt-6">
        The secret boundary
      </h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        <code>ANTHROPIC_API_KEY</code> is read from the environment only — never a CLI flag (shell history
        would keep it), never written to disk, never sent anywhere but{" "}
        <code>api.anthropic.com</code>. The site itself has no key field, no server, and no request path
        that could reach a model — it is a static export with zero API routes.
      </p>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        The two scheduled workflows that use the key run on a schedule or a manual dispatch only, never on a
        pull request or any other externally-triggerable event — checked mechanically in CI (
        <code>scripts/lint-workflow-secrets.mjs</code>), not just by review, so a workflow file that starts
        reading the key from a fork-reachable trigger fails the build.
      </p>

      <h2 id="failure-modes" className="mt-10 font-semibold scroll-mt-6">
        Failure modes
      </h2>
      <table className="mt-3 w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b hairline">
            <th className="pr-4 py-2 font-medium">Situation</th>
            <th className="pr-4 py-2 font-medium">What happens</th>
          </tr>
        </thead>
        <tbody className="align-top">
          <tr className="border-b hairline">
            <td className="pr-4 py-2">Rate limit or transient server error</td>
            <td className="pr-4 py-2 text-ink/80">
              Backs off with jitter, up to three attempts; the trial is then <code>noResult</code>, never
              scored as a failure.
            </td>
          </tr>
          <tr className="border-b hairline">
            <td className="pr-4 py-2">Response truncated at the token limit</td>
            <td className="pr-4 py-2 text-ink/80">
              <code>noResult</code> with a reason; <code>lint</code> requires enough headroom that this stays
              rare.
            </td>
          </tr>
          <tr className="border-b hairline">
            <td className="pr-4 py-2">Any trial comes back <code>noResult</code></td>
            <td className="pr-4 py-2 text-ink/80">
              The reading is <code>partial</code>; missing trials are never dropped from the denominator, and
              the reading is excluded from every aggregate comparison.
            </td>
          </tr>
          <tr className="border-b hairline">
            <td className="pr-4 py-2">Process crashes or is cancelled mid-batch</td>
            <td className="pr-4 py-2 text-ink/80">
              A deterministic id is recorded as pending before submission; a cell with a recorded batch id
              refuses a second submission. A pending cell with no batch id is genuinely ambiguous and{" "}
              <code>--resume</code> refuses to guess rather than risk a duplicate charge.
            </td>
          </tr>
          <tr className="border-b hairline">
            <td className="pr-4 py-2">A spend cap is tripped mid-run</td>
            <td className="pr-4 py-2 text-ink/80">
              Stops submitting, writes the reading <code>aborted</code>, commits, and the site shows a
              stale-observatory banner. Never silent.
            </td>
          </tr>
          <tr className="border-b hairline">
            <td className="pr-4 py-2">A model id is retired or resolves via alias to a new snapshot</td>
            <td className="pr-4 py-2 text-ink/80">
              Published as an event; every comparison touching it becomes <code>cannot-attribute</code>{" "}
              rather than silently averaging across a swap.
            </td>
          </tr>
          <tr className="border-b hairline">
            <td className="pr-4 py-2">The API key is missing or invalid</td>
            <td className="pr-4 py-2 text-ink/80">
              Exits before spending anything, writes a <code>skipped</code> record with the reason, and
              commits it.
            </td>
          </tr>
          <tr>
            <td className="pr-4 py-2">A suite is edited between plan and run</td>
            <td className="pr-4 py-2 text-ink/80">
              The plan pins the suite&apos;s hash; a mismatch refuses to run and asks for a re-plan instead of
              running against a suite it no longer matches.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="limitations" className="mt-10 font-semibold scroll-mt-6">
        Limitations
      </h2>
      <ul className="mt-2 text-sm text-ink/80 list-disc pl-5 space-y-1">
        <li>The presentation here is not your production runtime — it approximates one shape, not every harness.</li>
        <li>No seed parameter exists on the Anthropic API; exact reproduction of a single trial is not possible, only the reading&apos;s aggregate.</li>
        <li>At k=3, no single item carries a confidence interval — inference lives at the suite level only.</li>
        <li>Aliases can be substituted by the provider between run groups; when that happens it publishes as a labelled event, not a silent swap.</li>
        <li>Anthropic-only panel at v1 — nothing here compares vendors.</li>
        <li>These suites are one person&apos;s harness — evidence about this project&apos;s presentation, not a claim about anyone else&apos;s harness or about a model&apos;s capability in isolation.</li>
      </ul>
    </main>
  );
}
