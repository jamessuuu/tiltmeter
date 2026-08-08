/**
 * Regression tests for the COMMITTED `observatory/**` data (SPEC §11's four
 * launch suites, §8's panel, §7's pricing manifest, §7's models.json) —
 * mirrors `core/presentation.test.ts`'s precedent of validating the
 * committed `skill-tool@1.json` against the real schema. This file is the
 * one place that would catch a hand-edit to any committed observatory file
 * breaking schema, the negatives quota, the null pair, or a dangling
 * cross-reference between a suite and its presentation/panel/pricing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activeItems, meetsNegativesQuota, parseSuite, suiteSpecHash, type Suite } from "./core/suite.js";
import { parsePresentation } from "./core/presentation.js";
import { hasNullPair, parsePanel } from "./core/plan.js";
import { parsePricingManifest, selectPricingRow } from "./core/pricing.js";
import { findModelEntry, parseModels } from "./core/models.js";
import { lintSuite } from "./core/lint.js";

function observatoryPath(relPath: string): string {
  return fileURLToPath(new URL(`../../../observatory/${relPath}`, import.meta.url));
}

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(observatoryPath(relPath), "utf8"));
}

const SUITE_IDS = ["house-skill-activation", "mcp-tool-selection", "routing-adherence", "output-contract"] as const;

function loadSuite(id: string): Suite {
  return parseSuite(readJson(`suites/${id}.suite.json`));
}

describe("SPEC §11: the four launch suites, committed", () => {
  it("every suite parses against the real schema", () => {
    for (const id of SUITE_IDS) expect(() => loadSuite(id)).not.toThrow();
  });

  it("every suite meets the negatives quota (>= max(3, 20% of active items))", () => {
    for (const id of SUITE_IDS) {
      const suite = loadSuite(id);
      expect(meetsNegativesQuota(suite), `${id} negatives quota`).toBe(true);
    }
  });

  it("every suite's declared presentation id has a committed presentation file that parses", () => {
    for (const id of SUITE_IDS) {
      const suite = loadSuite(id);
      expect(() => parsePresentation(readJson(`presentations/${suite.presentation}.json`))).not.toThrow();
    }
  });

  it("SPEC §11: ~108 active items total, >=31% negative", () => {
    let total = 0;
    let negatives = 0;
    for (const id of SUITE_IDS) {
      const active = activeItems(loadSuite(id));
      total += active.length;
      negatives += active.filter((i) => i.polarity === "negative").length;
    }
    expect(total).toBe(108);
    expect(negatives / total).toBeGreaterThanOrEqual(0.31);
  });

  it("SPEC §11's per-suite item counts match exactly", () => {
    const expected: Record<string, { pos: number; neg: number }> = {
      "house-skill-activation": { pos: 20, neg: 12 },
      "mcp-tool-selection": { pos: 20, neg: 8 },
      "routing-adherence": { pos: 16, neg: 6 },
      "output-contract": { pos: 18, neg: 8 },
    };
    for (const id of SUITE_IDS) {
      const active = activeItems(loadSuite(id));
      const neg = active.filter((i) => i.polarity === "negative").length;
      const pos = active.length - neg;
      expect({ id, pos, neg }).toEqual({ id, ...expected[id] });
    }
  });

  it("every artifact carries a real provenance level — public artifacts are byte-attributable (repo+commit+blobSha)", () => {
    for (const id of SUITE_IDS) {
      const suite = loadSuite(id);
      for (const artifact of suite.artifacts) {
        if (artifact.source.origin === "public") {
          expect(artifact.source.repo.length).toBeGreaterThan(0);
          expect(artifact.source.commit.length).toBeGreaterThan(0);
          expect(artifact.source.blobSha.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("mcp-tool-selection's artifacts are ALL public (vendored from real, public MCP server repos) — none private", () => {
    const suite = loadSuite("mcp-tool-selection");
    expect(suite.artifacts.every((a) => a.source.origin === "public")).toBe(true);
  });

  it("lints clean with no prior git history (a brand-new suite's first commit)", () => {
    for (const id of SUITE_IDS) {
      const result = lintSuite(loadSuite(id), undefined);
      expect(result.ok, `${id}: ${JSON.stringify(result.issues)}`).toBe(true);
    }
  });

  it("suiteSpecHash is a stable, non-empty hex string for every suite", () => {
    for (const id of SUITE_IDS) {
      const hash = suiteSpecHash(loadSuite(id));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("SPEC §8: observatory/panel.json", () => {
  it("parses and carries the mandatory null pair", () => {
    const panel = parsePanel(readJson("panel.json"));
    expect(hasNullPair(panel)).toBe(true);
  });

  it("standing panel is exactly Haiku 4.5 + Sonnet 5 + the Haiku null cell", () => {
    const panel = parsePanel(readJson("panel.json"));
    const models = panel.entries.map((e) => ({ cellId: e.cellId, modelIdRequested: e.modelIdRequested, role: e.role }));
    expect(models).toEqual([
      { cellId: "haiku45", modelIdRequested: "claude-haiku-4-5", role: "standing" },
      { cellId: "sonnet5", modelIdRequested: "claude-sonnet-5", role: "standing" },
      { cellId: "haiku45-null", modelIdRequested: "claude-haiku-4-5", role: "null" },
    ]);
  });
});

describe("SPEC §7: observatory/models.json", () => {
  it("parses and has a cited entry for every model panel.json requests", () => {
    const panel = parsePanel(readJson("panel.json"));
    const models = parseModels(readJson("models.json"));
    for (const entry of panel.entries) {
      const found = findModelEntry(models, entry.modelIdRequested);
      expect(found, `models.json entry for ${entry.modelIdRequested}`).toBeDefined();
      expect(found?.sourceUrl.startsWith("https://")).toBe(true);
      expect(found?.releasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("SPEC §8: the pricing manifest covers every panel model", () => {
  it("selectPricingRow resolves for every panel entry's model, dated today", () => {
    const panel = parsePanel(readJson("panel.json"));
    const pricing = parsePricingManifest(readJson("pricing/pricing.2026-08-08.json"));
    for (const entry of panel.entries) {
      expect(() => selectPricingRow(pricing, entry.modelIdRequested, "2026-08-09")).not.toThrow();
    }
  });
});
