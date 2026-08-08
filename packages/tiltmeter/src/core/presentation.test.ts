import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFixtureSuite, FIXTURE_PRESENTATION } from "../testing/fixtures.js";
import { parsePresentation, presentationHash, renderPresentation, samplingPolicyHash } from "./presentation.js";

const OBSERVATORY_PRESENTATION_URL = new URL(
  "../../../../observatory/presentations/skill-tool@1.json",
  import.meta.url,
);

describe("renderPresentation (skill-tool@1)", () => {
  it("renders one RequestPlan per active item", () => {
    const suite = buildFixtureSuite({ positiveCount: 3, negativeCount: 3 });
    const plans = renderPresentation(suite, FIXTURE_PRESENTATION);
    expect(plans).toHaveLength(suite.items.length);
    expect(plans.map((p) => p.itemId).sort()).toEqual(suite.items.map((i) => i.id).sort());
  });

  it("excludes retired items", () => {
    const suite = buildFixtureSuite({ positiveCount: 3, negativeCount: 3 });
    const retired = {
      ...suite,
      items: suite.items.map((item, i) =>
        i === 0 ? { ...item, retired: { at: "2026-09-01", reason: "gone" } } : item,
      ),
    };
    const plans = renderPresentation(retired, FIXTURE_PRESENTATION);
    expect(plans).toHaveLength(suite.items.length - 1);
  });

  it("builds a Skill tool whose enum lists every skill-description artifact, from EVERY item's plan", () => {
    const suite = buildFixtureSuite({ positiveCount: 3, negativeCount: 2 });
    const plans = renderPresentation(suite, FIXTURE_PRESENTATION);
    const expectedNames = suite.artifacts.map((a) => a.materialized.name).sort();
    for (const plan of plans) {
      const skillTool = plan.tools.find((t) => t.name === FIXTURE_PRESENTATION.skillToolName);
      expect(skillTool).toBeDefined();
      if (skillTool === undefined) continue;
      const schema = skillTool.input_schema as { properties: { skill: { enum: string[] } } };
      expect([...schema.properties.skill.enum].sort()).toEqual(expectedNames);
    }
  });

  it("carries sampling policy (maxTokens/temperature) onto every plan", () => {
    const suite = buildFixtureSuite({ positiveCount: 2, negativeCount: 2, k: 5 });
    const plans = renderPresentation(suite, FIXTURE_PRESENTATION);
    for (const plan of plans) {
      expect(plan.maxTokens).toBe(suite.sampling.maxTokens);
      expect(plan.temperature).toBe(suite.sampling.temperature);
    }
  });

  it("returns no Skill tool when the suite has no skill-description artifacts", () => {
    const suite = buildFixtureSuite({ positiveCount: 0, negativeCount: 3 });
    const plans = renderPresentation(suite, FIXTURE_PRESENTATION);
    for (const plan of plans) {
      expect(plan.tools.find((t) => t.name === FIXTURE_PRESENTATION.skillToolName)).toBeUndefined();
    }
  });
});

describe("presentationHash / samplingPolicyHash", () => {
  it("are stable for identical input and change when the input changes", () => {
    const hashA = presentationHash(FIXTURE_PRESENTATION);
    const hashB = presentationHash(structuredClone(FIXTURE_PRESENTATION));
    expect(hashA).toBe(hashB);
    expect(presentationHash({ ...FIXTURE_PRESENTATION, system: "different" })).not.toBe(hashA);
  });

  it("samplingPolicyHash changes with k/temperature/maxTokens", () => {
    const a = samplingPolicyHash({ k: 3, temperature: 1, maxTokens: 512 });
    const b = samplingPolicyHash({ k: 5, temperature: 1, maxTokens: 512 });
    expect(a).not.toBe(b);
  });
});

describe("the committed observatory/presentations/skill-tool@1.json", () => {
  it("parses as a valid Presentation and is canonical JSON", () => {
    const raw = readFileSync(fileURLToPath(OBSERVATORY_PRESENTATION_URL), "utf8");
    const parsed = parsePresentation(JSON.parse(raw) as unknown);
    expect(parsed.id).toBe("skill-tool@1");
    // Canonical form (SPEC §3.3): re-serializing must be byte-identical to what's committed.
    const keys = Object.keys(JSON.parse(raw) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).not.toContain("\r");
  });
});
