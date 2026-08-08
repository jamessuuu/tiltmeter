/**
 * Fixture builders for tests and evals (SPEC §14 M1's "./testing" export).
 * Self-contained — these do not read `observatory/presentations/*.json`
 * (core/testing stay isomorphic; see eslint boundary in eslint.config.mjs),
 * they declare an equivalent minimal presentation inline.
 */
import type { Artifact, Item, Suite } from "../core/suite.js";
import type { Presentation } from "../core/presentation.js";
import type { FakeScript } from "./fake-model-client.js";
import { multiToolTrial, noToolTrial, textTrial, toolUseTrial, type TrialResult } from "./fake-model-client.js";

export const FIXTURE_PRESENTATION: Presentation = {
  formatVersion: 1,
  id: "skill-tool@1",
  system: "You are an agent with access to skills through the Skill tool. Call it when a skill matches; otherwise answer normally.",
  toolChoice: { type: "auto" },
  skillToolName: "Skill",
  skillToolDescriptionHeader: "Available skills:",
};

function fixtureArtifact(name: string): Artifact {
  return {
    id: `skill.${name}`,
    kind: "skill-description",
    source: {
      origin: "private",
      repo: null,
      path: `fixtures/${name}`,
      field: "description",
      capturedAt: "2026-08-08",
    },
    materialized: { name, description: `Fixture skill "${name}" — activates on its matching scenario.` },
  };
}

function fixturePositiveItem(name: string, registeredAt: string): Item {
  return {
    id: `pos-${name}`,
    probe: "activation",
    polarity: "positive",
    artifactRefs: [`skill.${name}`],
    registeredAt,
    scenario: `Please help me with the ${name} task.`,
    expect: { scorer: "tool-called", name: "Skill", args: { skill: name } },
  };
}

function fixtureNegativeItem(id: string, registeredAt: string): Item {
  return {
    id,
    probe: "activation",
    polarity: "negative",
    registeredAt,
    scenario: `Off-topic scenario for ${id}, no skill should fire.`,
    expect: { scorer: "no-tool-called" },
  };
}

export interface BuildFixtureSuiteOptions {
  id?: string;
  positiveCount: number;
  negativeCount: number;
  k?: number;
  registeredAt?: string;
}

/** A suite of `positiveCount` tool-called items + `negativeCount` no-tool-called items, meeting the negatives quota. */
export function buildFixtureSuite(options: BuildFixtureSuiteOptions): Suite {
  const { id = "fixture-suite", positiveCount, negativeCount, k = 3, registeredAt = "2026-08-08" } = options;
  const positives: Item[] = [];
  const artifacts: Artifact[] = [];
  for (let i = 1; i <= positiveCount; i++) {
    const name = `skill-${String(i)}`;
    artifacts.push(fixtureArtifact(name));
    positives.push(fixturePositiveItem(name, registeredAt));
  }
  const negatives: Item[] = [];
  for (let i = 1; i <= negativeCount; i++) {
    negatives.push(fixtureNegativeItem(`neg-${String(i)}`, registeredAt));
  }
  return {
    formatVersion: 1,
    id,
    presentation: "skill-tool@1",
    docs: "Fixture suite for tests/evals — not a real harness artifact.",
    metrics: ["overall", "triggerRate", "falsePositiveRate"],
    sampling: { k, temperature: 1, maxTokens: 512 },
    artifacts,
    items: [...positives, ...negatives],
  };
}

/** Build a fake trial for one item, correct (passes its `expect`) or incorrect (fails it), uniformly. Covers all eight SPEC §3.2 scorer kinds — used by `scriptForBehavior` for calibration/golden fixtures, which only ever build `tool-called`/`no-tool-called` items (M1-M3 scope), but this switch must stay exhaustive as `core/scorers.ts` grows. */
function trialForItem(item: Item, correct: boolean): TrialResult {
  switch (item.expect.scorer) {
    case "tool-called":
      return correct ? toolUseTrial(item.expect.name, item.expect.args ?? {}) : noToolTrial();
    case "no-tool-called":
      return correct ? noToolTrial() : toolUseTrial("Skill", { skill: "spurious-wrong-skill" });
    case "tool-in-set": {
      const [firstName] = item.expect.names;
      return correct && firstName !== undefined ? toolUseTrial(firstName, {}) : noToolTrial();
    }
    case "arg-enum": {
      const [firstValue] = item.expect.values;
      return correct && firstValue !== undefined
        ? toolUseTrial(item.expect.name, { [item.expect.key]: firstValue })
        : noToolTrial();
    }
    case "arg-required-keys": {
      const input = Object.fromEntries(item.expect.keys.map((k) => [k, "fixture-value"]));
      return correct ? toolUseTrial(item.expect.name, input) : toolUseTrial(item.expect.name, {});
    }
    case "tool-order":
      return correct
        ? multiToolTrial(item.expect.names.map((name) => ({ name })))
        : noToolTrial();
    case "literal-prefix":
      return correct ? textTrial(item.expect.prefix) : textTrial("unexpected preamble");
    case "json-schema-valid":
      return correct ? toolUseTrial(item.expect.name, {}) : noToolTrial();
  }
}

/**
 * Build a `FakeScript` for a suite where `behavior(itemId)` decides, per
 * item, whether ALL k attempts pass (true) or ALL k attempts fail (false)
 * — deterministic, no flakiness. Used to build "baseline" / "N items
 * flipped" fixture pairs (SPEC §12).
 */
export function scriptForBehavior(suite: Suite, behavior: (itemId: string) => boolean): FakeScript {
  const script: FakeScript = {};
  for (const item of suite.items) {
    if (item.retired !== undefined) continue;
    const trial = trialForItem(item, behavior(item.id));
    const perAttempt: Record<number, TrialResult> = {};
    for (let attempt = 1; attempt <= suite.sampling.k; attempt++) {
      perAttempt[attempt] = trial;
    }
    script[item.id] = perAttempt;
  }
  return script;
}

/** Every item passes. */
export function allPassBehavior(): (itemId: string) => boolean {
  return () => true;
}

/** Every item in `flippedIds` fails; everything else passes. */
export function flippedBehavior(flippedIds: readonly string[]): (itemId: string) => boolean {
  const flipped = new Set(flippedIds);
  return (itemId) => !flipped.has(itemId);
}
