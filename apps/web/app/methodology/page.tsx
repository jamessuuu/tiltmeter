import type { Metadata } from "next";

export const dynamic = "error";

export const metadata: Metadata = { title: "Methodology" };

/** SPEC §10: presentation templates, scorers, k/temperature and why not 0, the axis rules, the bootstrap and its bar, the noise floor, cost policy, Limitations. */
export default function MethodologyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 prose-content">
      <h1 className="text-2xl font-semibold tracking-tight">Methodology</h1>

      <h2 className="mt-8 font-semibold">Presentation templates</h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        A presentation is a committed template — system-block layout, how each artifact kind renders into the
        request, tool_choice policy, and stop conditions — hashed into every reading&apos;s axis tuple.
        Changing a presentation invalidates comparison, deliberately. Four are live:{" "}
        <code>skill-tool@1</code> (a <code>skill-description</code> artifact becomes one entry in a{" "}
        <code>Skill</code> tool&apos;s enum, mirroring Claude Code&apos;s own shape), <code>tool-select@1</code>{" "}
        (real MCP <code>tool-schema</code> artifacts rendered verbatim as <code>tools[]</code>),{" "}
        <code>routing-policy@1</code> (a routing decision surface: <code>route</code>/<code>split_task</code>/
        <code>select_pattern</code>), and <code>output-contract@1</code> (the ecosystem&apos;s own structured-
        output vocabulary plus a <code>decline</code> channel).
      </p>

      <h2 className="mt-8 font-semibold">Scorers — deterministic only</h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Every scorer is a structural check over the response&apos;s tool_use blocks (or, for one scorer only,
        a literal string comparison) — never a read of assistant prose for meaning. House rule: a scorer that
        must interpret prose means the probe is wrong; the probe gets fixed, not a judge added.
      </p>
      <ul className="mt-2 text-sm text-ink/80 list-disc pl-5 space-y-1">
        <li>
          <code>tool-called(name, args?)</code> — the first tool_use block matches a name, and optionally a
          subset of args.
        </li>
        <li>
          <code>no-tool-called</code> — no tool_use block at all.
        </li>
        <li>
          <code>tool-in-set(names)</code> — the first tool_use block&apos;s name is one of a declared set.
        </li>
        <li>
          <code>arg-enum(name, key, values)</code> — the first call&apos;s argument at <code>key</code> is a
          member of a declared set.
        </li>
        <li>
          <code>arg-required-keys(name, keys)</code> — the first call carries every required key, regardless
          of value.
        </li>
        <li>
          <code>tool-order(names)</code> — the FULL sequence of tool_use blocks exactly matches a declared
          order.
        </li>
        <li>
          <code>literal-prefix(prefix)</code> — the response&apos;s text starts with a literal, explicitly-
          demanded control token. Never used for prose meaning.
        </li>
        <li>
          <code>json-schema-valid(name, schema)</code> — the first call&apos;s args structurally validate
          against a minimal JSON-Schema subset (type/required/properties/enum/items).
        </li>
      </ul>

      <h2 className="mt-8 font-semibold">Sampling: k=3, temperature 1.0 — and why not 0</h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Every suite samples at t=1.0 with k=3 repeats (k=5 on release-triggered runs). Not temperature 0:
        production harnesses run at default sampling, so t=0 measures a configuration nobody ships; t=0 is
        not even deterministic on provider infrastructure, so it would buy false confidence; and k repeats at
        t=1.0 yield a per-item pass fraction — a genuine flakiness signal that t=0 hides entirely. No seed
        parameter exists on the Messages API — that irreducible non-determinism is exactly why every run
        group carries a null pair (below).
      </p>

      <h2 className="mt-8 font-semibold">The axis rules</h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        A cell&apos;s identity is its axis tuple: <code>suiteSpecHash</code>, <code>modelIdResolved</code>,{" "}
        <code>runnerBehaviorVersion</code>, <code>presentationHash</code>, <code>samplingPolicyHash</code>. A
        comparison is computed only when EXACTLY ONE element differs between two readings — model (the tilt),
        time (provider-side drift, same run group), or harness (a rebaseline pair, same run group). Anything
        else is <code>cannot-attribute</code>, published with <code>reasons[]</code> naming every axis element
        that co-varied — never guessed, never silently dropped. When <code>suiteSpecHash</code> changes, every
        chart line breaks at that point rather than drawing across it.
      </p>

      <h2 className="mt-8 font-semibold">The bootstrap and its bar</h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        A seeded paired percentile bootstrap over ITEMS (not trials), B=10,000 resamples, 95% CI. The seed is
        the first 8 hex characters of <code>sha256(bodyHashA + bodyHashB)</code> — deterministic and
        reproducible, never chosen by the analyst. <code>regressed</code>/<code>improved</code> require BOTH
        the 95% CI to exclude 0 AND the observed delta to meet the minimum detectable effect (default:
        1/n, one item&apos;s worth); otherwise <code>moved-within-noise</code>. A suite&apos;s verdict is the
        worst of its declared metrics. Per-item labels (held/broke/fixed/flaky) are descriptive, not
        inferential — at k=3 no single item carries its own confidence interval.
      </p>

      <h2 className="mt-8 font-semibold">The noise floor</h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Every run group runs the cheapest panel model TWICE as two distinct cells with identical axes — the
        null pair. The measured delta between those two cells bounds what &quot;moved&quot; can mean that
        week, since nothing about the model or the harness differs between them. It is the negative control
        that makes every positive claim on this site credible.
      </p>

      <h2 className="mt-8 font-semibold">Cost policy</h2>
      <p className="mt-2 text-sm text-ink/80 max-w-prose">
        Two independent cap layers: a provider-enforced monthly spend limit on a dedicated API key (the only
        cap that survives a leaked key), and runner-enforced caps tracked from the committed readings index —{" "}
        <code>maxRunUsd = $3.00</code>, <code>maxCellUsd = $1.50</code>, <code>maxMonthUsd = $15.00</code>.{" "}
        <code>plan</code> refuses to emit an over-cap plan; <code>run</code> re-checks against ACTUAL usage
        after every cell and, on breach, stops submitting, writes the reading <code>aborted</code>, and
        commits — never a silent skip. Batch API submission (−50%) is the standard mode.
      </p>

      <h2 className="mt-8 font-semibold">Limitations</h2>
      <ul className="mt-2 text-sm text-ink/80 list-disc pl-5 space-y-1">
        <li>The presentation here is not your production runtime — it approximates one shape, not every harness.</li>
        <li>No seed parameter exists on the Anthropic API; exact reproduction of a single trial is not possible, only the reading&apos;s aggregate.</li>
        <li>At k=3, no single item carries a confidence interval — inference lives at the suite level only.</li>
        <li>Aliases can be substituted by the provider between run groups; when that happens it publishes as a labelled event, not a silent swap.</li>
        <li>Anthropic-only panel at v1 — nothing here compares vendors.</li>
        <li>Batch results may lag a model release by up to 24 hours.</li>
        <li>These suites are James&apos;s own harness — they are evidence about this project&apos;s presentation, not a claim that they represent anyone else&apos;s harness, and never a claim about a model&apos;s capability in isolation.</li>
      </ul>
    </main>
  );
}
