import type { Metadata } from "next";
import { listPresentationIds, loadPresentation } from "@/lib/observatory";
import { loadCalibration } from "@/lib/calibration";

export const dynamic = "error";

export const metadata: Metadata = { title: "Methodology" };

/**
 * SPEC §10: presentation templates, scorers, k/temperature and why not 0,
 * the axis rules, the bootstrap and its bar, the noise floor, cost policy,
 * Limitations.
 *
 * Rebuilt 2026-09-07. Every one of those eight sections was a heading over
 * a grey paragraph, in a narrow column, 2,300px tall — a rendered README.
 * The content was good and stays; what changed is that the parts of it
 * which are DATA now render as data. The four presentations are read from
 * the committed artifacts rather than described from memory (they were
 * listed in prose, which is a claim that can go stale the moment a fifth
 * is added); the eight scorers become a table; the parameters that ARE the
 * method — k, temperature, B, CI, MDE — lead as a spec strip instead of
 * being buried mid-paragraph.
 */

const SCORERS: [string, string][] = [
  ["tool-called(name, args?)", "The first tool_use block matches a name, and optionally a subset of args."],
  ["no-tool-called", "No tool_use block at all."],
  ["tool-in-set(names)", "The first tool_use block's name is one of a declared set."],
  ["arg-enum(name, key, values)", "The first call's argument at key is a member of a declared set."],
  ["arg-required-keys(name, keys)", "The first call carries every required key, regardless of value."],
  ["tool-order(names)", "The FULL sequence of tool_use blocks exactly matches a declared order."],
  [
    "literal-prefix(prefix)",
    "The response's text starts with a literal, explicitly-demanded control token. Never used for prose meaning.",
  ],
  [
    "json-schema-valid(name, schema)",
    "The first call's args structurally validate against a minimal JSON-Schema subset (type/required/properties/enum/items).",
  ],
];

const PRESENTATION_NOTES: Record<string, string> = {
  "skill-tool@1": "A skill-description artifact becomes one entry in a Skill tool's enum, mirroring Claude Code's own shape.",
  "tool-select@1": "Real MCP tool-schema artifacts, rendered verbatim as tools[].",
  "routing-policy@1": "A routing decision surface: route / split_task / select_pattern.",
  "output-contract@1": "The ecosystem's own structured-output vocabulary, plus a decline channel.",
};

const LIMITATIONS = [
  "The presentation here is not your production runtime — it approximates one shape, not every harness.",
  "No seed parameter exists on the Anthropic API; exact reproduction of a single trial is not possible, only the reading's aggregate.",
  "At k=3, no single item carries a confidence interval — inference lives at the suite level only.",
  "Aliases can be substituted by the provider between run groups; when that happens it publishes as a labelled event, not a silent swap.",
  "Anthropic-only panel at v1 — nothing here compares vendors.",
  "Batch results may lag a model release by up to 24 hours.",
  "These suites are James's own harness — they are evidence about this project's presentation, not a claim that they represent anyone else's harness, and never a claim about a model's capability in isolation.",
];

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-[0.1em] text-ink/50">{k}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold tabular-nums tracking-[-0.02em]">{v}</dd>
    </div>
  );
}

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel panel-hover p-6 ${className}`}>
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-ink/55">{title}</h2>
      <div className="mt-3 text-[15px] leading-relaxed text-ink/75">{children}</div>
    </section>
  );
}

export default function MethodologyPage() {
  const calibration = loadCalibration();
  const presentations = listPresentationIds().map((id) => loadPresentation(id));

  return (
    <main>
      <div className="ambient border-b hairline">
        <div className="mx-auto max-w-5xl px-6 pb-12 pt-14">
          <h1 className="text-4xl font-semibold tracking-[-0.03em] sm:text-5xl rise">Methodology</h1>
          <p className="mt-4 max-w-[62ch] text-[17px] leading-relaxed text-ink/70 rise rise-2">
            Every scorer is a structural check over the response&apos;s tool_use blocks — never a read of
            assistant prose for meaning. A scorer that must interpret prose means the probe is wrong; the
            probe gets fixed, not a judge added.
          </p>
          <dl className="mt-9 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 rise rise-3">
            <Spec k="repeats" v="k=3" />
            <Spec k="temperature" v="1.0" />
            <Spec k="bootstrap B" v={calibration.bootstrapB.toLocaleString("en-US")} />
            <Spec k="interval" v="95% CI" />
            <Spec k="min effect" v="1/n" />
          </dl>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-24">
        {/* ------------------------------------------------ scorers ------- */}
        <section className="mt-14" aria-labelledby="scorers-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id="scorers-heading" className="text-2xl font-semibold tracking-[-0.02em]">
              The eight scorers
            </h2>
            <span className="font-mono text-xs text-ink/50">deterministic only</span>
          </div>
          <div className="panel mt-6 overflow-hidden" data-surface="flat">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Every scorer and the structural check it performs</caption>
              <thead>
                <tr className="border-b hairline">
                  <th scope="col" className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink/55">
                    Scorer
                  </th>
                  <th scope="col" className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink/55">
                    What it checks
                  </th>
                </tr>
              </thead>
              <tbody>
                {SCORERS.map(([name, what], i) => (
                  <tr key={name} className={i > 0 ? "border-t hairline" : ""}>
                    <td className="whitespace-nowrap px-5 py-3 align-top font-mono text-[12.5px] text-ink">
                      {name}
                    </td>
                    <td className="px-5 py-3 align-top text-[14px] leading-relaxed text-ink/70">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ------------------------------------------ presentations ------- */}
        <section className="mt-16" aria-labelledby="presentations-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id="presentations-heading" className="text-2xl font-semibold tracking-[-0.02em]">
              Presentation templates
            </h2>
            <span className="font-mono text-xs tabular-nums text-ink/50">
              {presentations.length} committed
            </span>
          </div>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            A presentation is a committed template — system-block layout, how each artifact kind renders into
            the request, tool_choice policy, stop conditions — hashed into every reading&apos;s axis tuple.
            Changing one invalidates comparison, deliberately.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {presentations.map((p, i) => (
              <div
                key={p.id}
                className="panel panel-hover p-5 rise"
                style={{ animationDelay: `${String(i * 55)}ms` }}
              >
                <h3 className="font-mono text-[15px] font-semibold tracking-tight">{p.id}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink/70">
                  {PRESENTATION_NOTES[p.id] ?? "A committed request template."}
                </p>
                {/* The system block is the part that actually differs between
                    these four (233-1,210 chars) and it is what gets hashed
                    into presentationHash — tool name and tool_choice are
                    identical across all four, so printing them on every card
                    was four repetitions of one fact. */}
                <p className="mt-4 flex items-baseline justify-between gap-3 border-t hairline pt-3 font-mono text-[11px] text-ink/45">
                  <span>system block</span>
                  <span className="tabular-nums text-ink/60">
                    {p.system.length.toLocaleString("en-US")} chars
                  </span>
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------- the rules ---- */}
        <section className="mt-16" aria-labelledby="rules-heading">
          <h2 id="rules-heading" className="text-2xl font-semibold tracking-[-0.02em]">
            What makes a number publishable
          </h2>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card title="The axis rules">
              A cell&apos;s identity is its axis tuple: <code className="font-mono text-[13px]">suiteSpecHash</code>,{" "}
              <code className="font-mono text-[13px]">modelIdResolved</code>,{" "}
              <code className="font-mono text-[13px]">runnerBehaviorVersion</code>,{" "}
              <code className="font-mono text-[13px]">presentationHash</code>,{" "}
              <code className="font-mono text-[13px]">samplingPolicyHash</code>. A comparison is computed only
              when EXACTLY ONE differs. Anything else is{" "}
              <code className="font-mono text-[13px]">cannot-attribute</code>, published with every co-varying
              axis named — never guessed, never silently dropped.
            </Card>
            <Card title="The bootstrap and its bar">
              A seeded paired percentile bootstrap over ITEMS, not trials. The seed is the first 8 hex of{" "}
              <code className="font-mono text-[13px]">sha256(bodyHashA + bodyHashB)</code> — never chosen by
              the analyst. <code className="font-mono text-[13px]">regressed</code>/
              <code className="font-mono text-[13px]">improved</code> require BOTH the CI to exclude 0 AND the
              delta to meet the minimum detectable effect; otherwise{" "}
              <code className="font-mono text-[13px]">moved-within-noise</code>.
            </Card>
            <Card title="The noise floor">
              Every run group runs the cheapest panel model TWICE, as two distinct cells with identical axes —
              the null pair. The delta between them bounds what &quot;moved&quot; can mean that week, since
              nothing about the model or the harness differs. It is the negative control that makes every
              positive claim here credible.
            </Card>
            <Card title="Sampling: why not temperature 0">
              Production harnesses run at default sampling, so t=0 measures a configuration nobody ships — and
              t=0 is not even deterministic on provider infrastructure. k repeats at t=1.0 yield a per-item
              pass fraction, a real flakiness signal t=0 hides entirely.
            </Card>
          </div>
        </section>

        {/* -------------------------------------------- cost policy ------- */}
        <section className="mt-16" aria-labelledby="cost-heading">
          <h2 id="cost-heading" className="text-2xl font-semibold tracking-[-0.02em]">
            Cost policy
          </h2>
          <div className="panel mt-6 p-6 sm:p-7">
            <dl className="grid grid-cols-3 gap-6 sm:max-w-md">
              <Spec k="per cell" v="$1.50" />
              <Spec k="per run" v="$3.00" />
              <Spec k="per month" v="$15.00" />
            </dl>
            <p className="mt-6 max-w-[70ch] text-[15px] leading-relaxed text-ink/70">
              Two independent cap layers: a provider-enforced monthly spend limit on a dedicated API key — the
              only cap that survives a leaked key — and runner-enforced caps tracked from the committed
              readings index. <code className="font-mono text-[13px]">plan</code> refuses to emit an over-cap
              plan; <code className="font-mono text-[13px]">run</code> re-checks against ACTUAL usage after
              every cell and, on breach, stops submitting, writes the reading{" "}
              <code className="font-mono text-[13px]">aborted</code>, and commits — never a silent skip. Batch
              submission (−50%) is the standard mode.
            </p>
          </div>
        </section>

        {/* -------------------------------------------- limitations ------- */}
        <section className="mt-16" aria-labelledby="limits-heading">
          <h2 id="limits-heading" className="text-2xl font-semibold tracking-[-0.02em]">
            Limitations
          </h2>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink/70">
            Stated in full, on the page, rather than in a footnote — every one of these bounds what any number
            here is allowed to mean.
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {LIMITATIONS.map((l) => (
              <li key={l} className="well p-4 text-[14px] leading-relaxed text-ink/75">
                {l}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
