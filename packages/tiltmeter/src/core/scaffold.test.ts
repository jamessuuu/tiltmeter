import { describe, expect, it } from "vitest";
import { parseSuite, meetsNegativesQuota, suiteSpecHash } from "./suite.js";
import { parsePanel } from "./plan.js";
import { parsePresentation } from "./presentation.js";
import { parsePricingManifest } from "./pricing.js";
import {
  buildSkillActivationSuite,
  buildToolSelectionSuite,
  deriveTodoScenario,
  negativeCountFor,
  SCAFFOLD_PANEL,
  SCAFFOLD_PRICING_MANIFEST,
  SCAFFOLD_SKILL_TOOL_PRESENTATION,
  SCAFFOLD_TOOL_SELECT_PRESENTATION,
} from "./scaffold.js";

describe("negativeCountFor (SPEC §3.2 negatives quota)", () => {
  it("is at least 3 even for a tiny suite", () => {
    expect(negativeCountFor(1)).toBe(3);
    expect(negativeCountFor(0)).toBe(3);
  });

  it("the result N always satisfies meetsNegativesQuota's REAL formula (20% of positives+negatives together, not positives alone)", () => {
    for (const positiveCount of [0, 1, 2, 3, 4, 5, 9, 10, 19, 20, 21, 30, 99, 100, 250]) {
      const n = negativeCountFor(positiveCount);
      const required = Math.max(3, Math.ceil(0.2 * (positiveCount + n)));
      expect(n).toBeGreaterThanOrEqual(required);
      // and it's the SMALLEST such N — one fewer would fail the quota.
      const oneFewer = n - 1;
      const requiredOneFewer = Math.max(3, Math.ceil(0.2 * (positiveCount + oneFewer)));
      expect(oneFewer).toBeLessThan(requiredOneFewer);
    }
  });
});

describe("deriveTodoScenario", () => {
  it("is unmistakably a TODO, never a fabricated real scenario", () => {
    const scenario = deriveTodoScenario("Does the thing. Also does another thing.");
    expect(scenario).toContain("TODO");
    expect(scenario).toContain("Does the thing.");
  });

  it("truncates a long description's first sentence", () => {
    const longSentence = `${"a".repeat(200)}.`;
    const scenario = deriveTodoScenario(longSentence);
    expect(scenario.length).toBeLessThan(longSentence.length + 100);
    expect(scenario).toContain("...");
  });

  it("falls back to the whole description when there is no sentence-ending punctuation", () => {
    expect(deriveTodoScenario("no punctuation here")).toContain("no punctuation here");
  });
});

describe("buildSkillActivationSuite", () => {
  const skills = [
    { name: "taste", description: "Anti-slop constitution for design. Load before designing anything.", sourcePath: ".claude/skills/taste/SKILL.md" },
    { name: "retro", description: "Self-improvement engine for the agent ecosystem.", sourcePath: ".claude/skills/retro/SKILL.md" },
  ];

  it("produces a suite that parses and lints clean (SPEC §14 M8's own gate)", () => {
    const suite = buildSkillActivationSuite(skills, { id: "from-skills", registeredAt: "2026-08-09" });
    const parsed = parseSuite(suite); // throws on schema violation
    expect(parsed.presentation).toBe("skill-tool@1");
    expect(meetsNegativesQuota(parsed)).toBe(true);
    expect(parsed.sampling.maxTokens).toBeGreaterThanOrEqual(512);
  });

  it("one positive activation item per skill, referencing the right artifact", () => {
    const suite = buildSkillActivationSuite(skills, { id: "from-skills", registeredAt: "2026-08-09" });
    const positives = suite.items.filter((i) => i.polarity === "positive");
    expect(positives).toHaveLength(2);
    for (const item of positives) {
      expect(item.probe).toBe("activation");
      expect(item.expect).toMatchObject({ scorer: "tool-called", name: "Skill" });
    }
  });

  it("artifacts are always origin: private — init never fabricates public provenance", () => {
    const suite = buildSkillActivationSuite(skills, { id: "from-skills", registeredAt: "2026-08-09" });
    for (const artifact of suite.artifacts) {
      expect(artifact.source.origin).toBe("private");
    }
  });

  it("negative items reuse the generic pool, cycling if more are needed than the pool has", () => {
    const manySkills = Array.from({ length: 30 }, (_, i) => ({
      name: `skill-${String(i)}`,
      description: "Does a thing.",
      sourcePath: `dir/skill-${String(i)}/SKILL.md`,
    }));
    const suite = buildSkillActivationSuite(manySkills, { id: "many", registeredAt: "2026-08-09" });
    const negatives = suite.items.filter((i) => i.polarity === "negative");
    expect(negatives.length).toBe(negativeCountFor(30));
    expect(meetsNegativesQuota(suite)).toBe(true);
    // ids are all distinct even when scenario text repeats via cycling
    expect(new Set(negatives.map((i) => i.id)).size).toBe(negatives.length);
  });

  it("suiteSpecHash is a stable function of the content (deterministic scaffolding)", () => {
    const a = buildSkillActivationSuite(skills, { id: "from-skills", registeredAt: "2026-08-09" });
    const b = buildSkillActivationSuite(skills, { id: "from-skills", registeredAt: "2026-08-09" });
    expect(suiteSpecHash(a)).toBe(suiteSpecHash(b));
  });
});

describe("buildToolSelectionSuite", () => {
  const tools = [
    { name: "resolve-library-id", description: "Resolves a package name to a library ID.", inputSchema: { type: "object", properties: {} }, sourcePath: "tools.json" },
    { name: "get-docs", inputSchema: { type: "object", properties: {} }, sourcePath: "tools.json" },
  ];

  it("produces a suite that parses and lints clean", () => {
    const suite = buildToolSelectionSuite(tools, { id: "from-mcp", registeredAt: "2026-08-09" });
    const parsed = parseSuite(suite);
    expect(parsed.presentation).toBe("tool-select@1");
    expect(meetsNegativesQuota(parsed)).toBe(true);
  });

  it("negatives keep probe: tool-selection (matches the real mcp-tool-selection suite's own convention)", () => {
    const suite = buildToolSelectionSuite(tools, { id: "from-mcp", registeredAt: "2026-08-09" });
    const negatives = suite.items.filter((i) => i.polarity === "negative");
    expect(negatives.length).toBeGreaterThan(0);
    for (const item of negatives) {
      expect(item.probe).toBe("tool-selection");
      expect(item.expect).toEqual({ scorer: "no-tool-called" });
    }
  });

  it("a tool with no description still produces a valid materialized artifact (input_schema, no description key)", () => {
    const suite = buildToolSelectionSuite(tools, { id: "from-mcp", registeredAt: "2026-08-09" });
    const artifact = suite.artifacts.find((a) => a.id === "tool.get-docs");
    expect(artifact?.kind).toBe("tool-schema");
    if (artifact?.kind === "tool-schema") {
      expect(artifact.materialized.description).toBeUndefined();
    }
  });
});

describe("bundled templates parse under tiltmeter's own schemas (the tarball smoke test's real dependency)", () => {
  it("SCAFFOLD_PANEL has a valid mandatory null pair (SPEC §4)", () => {
    const panel = parsePanel(SCAFFOLD_PANEL);
    const nullEntries = panel.entries.filter((e) => e.role === "null");
    expect(nullEntries.length).toBeGreaterThan(0);
  });

  it("SCAFFOLD_PRICING_MANIFEST parses and covers the panel's model", () => {
    const manifest = parsePricingManifest(SCAFFOLD_PRICING_MANIFEST);
    expect(manifest.models.some((m) => m.modelId === "claude-haiku-4-5")).toBe(true);
  });

  it("both presentation templates parse and match their referenced ids", () => {
    expect(parsePresentation(SCAFFOLD_SKILL_TOOL_PRESENTATION).id).toBe("skill-tool@1");
    expect(parsePresentation(SCAFFOLD_TOOL_SELECT_PRESENTATION).id).toBe("tool-select@1");
  });
});
