/**
 * `tiltmeter init` (SPEC §7/§14 M8): "scaffolds a suite from real artifacts
 * (snapgauge snapshots carry tool schemas — free interop)." This module is
 * the PURE half — given already-read artifact inputs (skills or tool
 * schemas), it builds a lint-clean `Suite` plus the generic, portable
 * templates (`panel.json`, a bundled pricing manifest, both presentations)
 * `tiltmeter init` scaffolds alongside it so `tiltmeter lint` and
 * `tiltmeter plan --offline` both work from a clean clone with no other
 * files present (SPEC §14 M8's own gate). Reading a directory or a
 * `tools.json`/snapshot file is `src/cli/commands/init.ts`'s job (fs, not
 * pure); this file only knows how to turn already-parsed artifacts into a
 * suite.
 *
 * Honesty over automation, twice over: (1) every scaffolded artifact is
 * `source.origin: "private"` — never `"public"`, since `init` has no way
 * to know a real `repo`/`commit`/`blobSha` for someone else's harness
 * (SPEC §3.1 Decision 1: "guessing is never permitted"). (2) every
 * positive item's `scenario` is an explicit, unmissable TODO derived from
 * the artifact's own description — never a fabricated "good" eval prompt
 * (this project has a hard no-LLM-anywhere rule, so there is no way to
 * synthesize one that isn't a guess). Negative items are the one thing
 * this module ships as genuinely usable as-is: a fixed pool of generic,
 * plausible "should trigger nothing" prompts, true regardless of what the
 * artifacts are.
 */
import type { Artifact, Item, Sampling, Suite } from "./suite.js";
import type { Panel } from "./plan.js";
import type { Presentation } from "./presentation.js";
import type { PricingManifest } from "./pricing.js";

export const SCAFFOLD_SAMPLING: Sampling = { k: 3, temperature: 1.0, maxTokens: 512 };
export const SCAFFOLD_METRICS: readonly string[] = ["overall", "triggerRate", "falsePositiveRate"];

export const SCAFFOLD_DOCS =
  "Scaffolded by `tiltmeter init` (SPEC §7/§14 M8) — not a finished suite. " +
  "Every positive item's `scenario` is a TODO placeholder derived from the " +
  "artifact's own description; replace each one with a real, deliberately- " +
  "chosen scenario before this suite measures anything. Negative items are " +
  "generic distractor prompts, usable as committed. Review the whole file " +
  "before committing it — a suite vendors your artifact text verbatim " +
  "(SECURITY.md: 'suites vendor your artifact text — review before " +
  "committing a suite built from a private harness'). Run `tiltmeter lint` " +
  "after editing.";

/** A fixed pool of prompts that should trigger NEITHER a skill NOR a tool, regardless of what the suite's artifacts are — usable as committed, no TODO needed. Cycled (not truncated) when a suite needs more negatives than the pool has entries. */
const GENERIC_NEGATIVE_SCENARIOS: readonly string[] = [
  "Fix the typo in the README on line 12.",
  "What's 7 times 6?",
  "Rename the variable `x` to `count` in this function.",
  "What time zone is UTC+2?",
  "Summarize this paragraph in one sentence.",
  "List the days of the week.",
  "Convert 10 miles to kilometers.",
  "What does HTTP stand for?",
  "Format this JSON file with 2-space indentation.",
  "How many days are in February during a leap year?",
  "Capitalize the first letter of every word in this title.",
  "What is the boiling point of water in Fahrenheit?",
];

function negativeScenario(index: number): string {
  const scenario = GENERIC_NEGATIVE_SCENARIOS[index % GENERIC_NEGATIVE_SCENARIOS.length];
  if (scenario === undefined) throw new Error("unreachable — GENERIC_NEGATIVE_SCENARIOS is a fixed, nonempty pool");
  return scenario;
}

/**
 * SPEC §3.2 "negatives >= max(3, 20% of active items)" — `meetsNegativesQuota`
 * (`core/suite.ts`) computes the 20% against ALL active items, positives
 * AND negatives together, which makes the required count self-referential
 * (adding a negative to satisfy the quota raises the denominator the quota
 * is measured against). Solved by iterating to a fixed point rather than
 * the closed form, which the `max(3, …)` floor makes fiddly to get right
 * by hand — converges in a handful of steps since each iteration's
 * increase is damped by the 20% factor.
 */
export function negativeCountFor(positiveCount: number): number {
  let n = Math.max(3, Math.ceil(positiveCount * 0.2));
  for (;;) {
    const required = Math.max(3, Math.ceil(0.2 * (positiveCount + n)));
    if (n >= required) return n;
    n = required;
  }
}

/** Never a fabricated "good" eval prompt (no LLM anywhere in this project) — an honest, unmissable TODO carrying a real clue (the artifact's own first sentence) rather than a guess dressed up as a scenario. */
export function deriveTodoScenario(description: string): string {
  const trimmedDescription = description.trim();
  const firstSentenceMatch = /^.*?[.!?](?=\s|$)/.exec(trimmedDescription);
  const firstSentence = firstSentenceMatch !== null ? firstSentenceMatch[0] : trimmedDescription;
  const clue = firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}...` : firstSentence;
  return `TODO(tiltmeter init): replace this with a real scenario that should trigger it. Context clue from the artifact's own description: "${clue}"`;
}

/** `no-tool-called` negatives keep the SAME `probe` as the suite's positives (SPEC: the real `mcp-tool-selection` suite's own negatives are `probe: "tool-selection"`, not some other value) — only `polarity` and the scorer distinguish a negative item, never the probe type. */
function buildNegativeItems(count: number, registeredAt: string, probe: Item["probe"]): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `neg-${String(i + 1)}`,
    probe,
    polarity: "negative" as const,
    registeredAt,
    scenario: negativeScenario(i),
    expect: { scorer: "no-tool-called" as const },
  }));
}

export interface ScaffoldSkillInput {
  name: string;
  description: string;
  /** Where this skill was read from — becomes the artifact's `source.path` (never guessed; SPEC §3.1 Decision 1). */
  sourcePath: string;
}

export interface ScaffoldToolInput {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** Where this tool was read from — becomes the artifact's `source.path`. */
  sourcePath: string;
}

export interface BuildScaffoldSuiteOptions {
  id: string;
  /** `YYYY-MM-DD` — every artifact's `capturedAt` and every item's `registeredAt`. */
  registeredAt: string;
}

/** SPEC §11-shaped: a `house-skill-activation`-style suite from real `SKILL.md` descriptions, presented via `skill-tool@1`. */
export function buildSkillActivationSuite(skills: readonly ScaffoldSkillInput[], options: BuildScaffoldSuiteOptions): Suite {
  const artifacts: Artifact[] = skills.map((s) => ({
    id: `skill.${s.name}`,
    kind: "skill-description" as const,
    source: { origin: "private" as const, repo: null, path: s.sourcePath, field: "frontmatter.description", capturedAt: options.registeredAt },
    materialized: { name: s.name, description: s.description },
  }));

  const positives: Item[] = skills.map((s) => ({
    id: `pos-${s.name}`,
    probe: "activation" as const,
    polarity: "positive" as const,
    artifactRefs: [`skill.${s.name}`],
    registeredAt: options.registeredAt,
    scenario: deriveTodoScenario(s.description),
    expect: { scorer: "tool-called" as const, name: "Skill", args: { skill: s.name } },
  }));
  const negatives = buildNegativeItems(negativeCountFor(positives.length), options.registeredAt, "activation");

  return {
    formatVersion: 1,
    id: options.id,
    presentation: "skill-tool@1",
    docs: SCAFFOLD_DOCS,
    metrics: [...SCAFFOLD_METRICS],
    sampling: { ...SCAFFOLD_SAMPLING },
    artifacts,
    items: [...positives, ...negatives],
  };
}

/** SPEC §11-shaped: a `mcp-tool-selection`-style suite from real tool schemas (an MCP server's `tools/list`, or a snapgauge snapshot's `tools[]`), presented via `tool-select@1`. */
export function buildToolSelectionSuite(tools: readonly ScaffoldToolInput[], options: BuildScaffoldSuiteOptions): Suite {
  const artifacts: Artifact[] = tools.map((t) => ({
    id: `tool.${t.name}`,
    kind: "tool-schema" as const,
    source: { origin: "private" as const, repo: null, path: t.sourcePath, field: "tools[].input_schema", capturedAt: options.registeredAt },
    materialized: t.description === undefined ? { name: t.name, input_schema: t.inputSchema } : { name: t.name, description: t.description, input_schema: t.inputSchema },
  }));

  const positives: Item[] = tools.map((t) => ({
    id: `pos-${t.name}`,
    probe: "tool-selection" as const,
    polarity: "positive" as const,
    artifactRefs: [`tool.${t.name}`],
    registeredAt: options.registeredAt,
    scenario: deriveTodoScenario(t.description ?? t.name),
    expect: { scorer: "tool-called" as const, name: t.name },
  }));
  const negatives = buildNegativeItems(negativeCountFor(positives.length), options.registeredAt, "tool-selection");

  return {
    formatVersion: 1,
    id: options.id,
    presentation: "tool-select@1",
    docs: SCAFFOLD_DOCS,
    metrics: [...SCAFFOLD_METRICS],
    sampling: { ...SCAFFOLD_SAMPLING },
    artifacts,
    items: [...positives, ...negatives],
  };
}

/**
 * A minimal, valid default panel (SPEC §4: mandatory null pair) — scaffolded
 * ONLY when `observatory/panel.json` does not already exist. Deliberately
 * the cheapest model in both roles: a new user's first `tiltmeter plan` run
 * should cost cents, not dollars, before they have looked at anything.
 */
export const SCAFFOLD_PANEL: Panel = {
  formatVersion: 1,
  id: "standing",
  entries: [
    { cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" },
    { cellId: "haiku45-null", modelIdRequested: "claude-haiku-4-5", role: "null" },
  ],
};

/**
 * A bundled pricing snapshot — the same public Anthropic rate card
 * `observatory/pricing/pricing.2026-08-08.json` carries, under a distinct
 * `id` so it never collides with (or is mistaken for) James's own dated
 * manifest. Scaffolded ONLY when NO pricing manifest already exists (SPEC
 * §7 `plan`: `readPricingManifest` requires exactly one file present).
 * Rates drift — this is a starting point for `tiltmeter plan --offline` to
 * work out of the box, not a promise of currency; re-fetch from
 * https://platform.claude.com/docs/en/about-claude/pricing before trusting
 * a real estimate.
 */
export const SCAFFOLD_PRICING_MANIFEST: PricingManifest = {
  formatVersion: 1,
  id: "pricing.bundled",
  fetchedAt: "2026-08-08",
  source: "https://platform.claude.com/docs/en/about-claude/pricing — bundled with tiltmeter init; re-verify before trusting a real (non---offline) estimate",
  assumedOutputTokensPerTrial: 100,
  models: [
    {
      modelId: "claude-haiku-4-5",
      rows: [
        {
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          standard: { inputPerMTok: 1, outputPerMTok: 5 },
          batch: { inputPerMTok: 0.5, outputPerMTok: 2.5 },
          estimateMultiplier: 1.0,
        },
      ],
    },
    {
      modelId: "claude-sonnet-5",
      rows: [
        {
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-08-31",
          standard: { inputPerMTok: 2, outputPerMTok: 10 },
          batch: { inputPerMTok: 1, outputPerMTok: 5 },
          estimateMultiplier: 1.0,
        },
        {
          effectiveFrom: "2026-08-31",
          effectiveTo: null,
          standard: { inputPerMTok: 3, outputPerMTok: 15 },
          batch: { inputPerMTok: 1.5, outputPerMTok: 7.5 },
          estimateMultiplier: 1.0,
        },
      ],
    },
    {
      modelId: "claude-opus-5",
      rows: [
        {
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          standard: { inputPerMTok: 5, outputPerMTok: 25 },
          batch: { inputPerMTok: 2.5, outputPerMTok: 12.5 },
          estimateMultiplier: 1.0,
        },
      ],
    },
    {
      modelId: "claude-fable-5",
      rows: [
        {
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          standard: { inputPerMTok: 10, outputPerMTok: 50 },
          batch: { inputPerMTok: 5, outputPerMTok: 25 },
          estimateMultiplier: 1.3,
        },
      ],
    },
  ],
};

/** The generic `skill-tool@1` presentation template, byte-identical to `observatory/presentations/skill-tool@1.json` — a project-agnostic template (SPEC §7), safe to bundle. Scaffolded only when missing. */
export const SCAFFOLD_SKILL_TOOL_PRESENTATION: Presentation = {
  formatVersion: 1,
  id: "skill-tool@1",
  skillToolDescriptionHeader:
    "A skill is a packaged procedure for a particular kind of task. When the current request matches one, call this tool with its name; otherwise do not call it.",
  skillToolName: "Skill",
  system:
    "You are an agent with access to a set of skills, exposed through the Skill tool below. If the user's request matches a skill's description, call Skill with that skill's name. If nothing matches, answer normally without calling Skill.",
  toolChoice: { type: "auto" },
};

/** The generic `tool-select@1` presentation template, byte-identical to `observatory/presentations/tool-select@1.json`. Scaffolded only when missing. */
export const SCAFFOLD_TOOL_SELECT_PRESENTATION: Presentation = {
  formatVersion: 1,
  id: "tool-select@1",
  skillToolDescriptionHeader: "unused — this presentation carries no skill-description artifacts, only verbatim tool-schema artifacts.",
  skillToolName: "Skill",
  system:
    "You are an agent with access to the tools below. Call the single tool that best matches the user's request, with correctly-populated arguments. If none of the available tools apply, answer normally without calling any tool.",
  toolChoice: { type: "auto" },
};
