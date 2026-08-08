import { describe, expect, it } from "vitest";
import { buildFixtureSuite } from "../testing/fixtures.js";
import type { Item, Suite } from "./suite.js";
import {
  checkItemImmutability,
  lintSuite,
  MIN_MAX_TOKENS_HEADROOM_MULTIPLE,
  TYPICAL_TOOL_CALL_OUTPUT_TOKENS,
} from "./lint.js";

describe("lintSuite — negatives quota (SPEC §3.2: >= max(3, 20% of active items))", () => {
  it("ok when the quota is met", () => {
    const suite = buildFixtureSuite({ positiveCount: 8, negativeCount: 3 });
    const result = lintSuite(suite, undefined);
    expect(result.issues.some((i) => i.code === "negatives-quota")).toBe(false);
  });

  it("fails when negatives fall short", () => {
    const suite = buildFixtureSuite({ positiveCount: 20, negativeCount: 2 }); // 20% of 22 = 4.4 -> 5 required
    const result = lintSuite(suite, undefined);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "negatives-quota")).toBe(true);
  });
});

describe("lintSuite — maxTokens headroom", () => {
  function suiteWithMaxTokens(maxTokens: number): Suite {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3 });
    return { ...suite, sampling: { ...suite.sampling, maxTokens } };
  }

  it("ok at exactly the required floor", () => {
    const floor = MIN_MAX_TOKENS_HEADROOM_MULTIPLE * TYPICAL_TOOL_CALL_OUTPUT_TOKENS;
    const result = lintSuite(suiteWithMaxTokens(floor), undefined);
    expect(result.issues.some((i) => i.code === "maxTokens-headroom")).toBe(false);
  });

  it("fails below the floor", () => {
    const floor = MIN_MAX_TOKENS_HEADROOM_MULTIPLE * TYPICAL_TOOL_CALL_OUTPUT_TOKENS;
    const result = lintSuite(suiteWithMaxTokens(floor - 1), undefined);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "maxTokens-headroom")).toBe(true);
  });
});

describe("lintSuite — dangling artifact refs", () => {
  it("flags an item referencing an artifact id that does not exist", () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3 });
    const [firstItem] = suite.items;
    if (firstItem === undefined) throw new Error("expected an item");
    const tampered: Suite = {
      ...suite,
      items: [{ ...firstItem, artifactRefs: ["skill.does-not-exist"] }, ...suite.items.slice(1)],
    };
    const result = lintSuite(tampered, undefined);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "dangling-artifact-ref" && i.itemId === firstItem.id)).toBe(true);
  });
});

describe("lintSuite — no prior committed version (brand-new suite)", () => {
  it("passes the immutability check trivially when historicalItems is undefined", () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3 });
    const result = lintSuite(suite, undefined);
    expect(result.issues.some((i) => i.code === "item-edited-in-place" || i.code === "item-removed")).toBe(false);
  });
});

describe("lintSuite — unresolved historical baseline (SPEC §3.1 Decision 2: never silently pass an unresolvable baseline)", () => {
  it("fails with immutability-baseline-unresolved when the caller could not establish a baseline that should exist", () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3 });
    const result = lintSuite(suite, undefined, "a previous commit's suite file does not parse under the current schema");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "immutability-baseline-unresolved")).toBe(true);
  });

  it("stays a pass when no unresolved reason is given — the genuine first-publish case", () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3 });
    const result = lintSuite(suite, undefined, undefined);
    expect(result.issues.some((i) => i.code === "immutability-baseline-unresolved")).toBe(false);
  });

  it("an unresolved baseline still fails the suite even if the resolved item set (if any were passed) is otherwise clean", () => {
    const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3 });
    // Pathological input a resolver should never actually produce (items AND
    // an unresolved reason together) — even so, the unresolved reason must
    // win: `lintSuite` never treats "some items happened to be resolvable"
    // as license to ignore an explicit unresolved signal.
    const result = lintSuite(suite, suite.items, "defensive: unresolved must always fail regardless of what else was passed");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "immutability-baseline-unresolved")).toBe(true);
  });
});

describe("checkItemImmutability (SPEC §3.1 Decision 2: anti-p-hacking)", () => {
  const suite = buildFixtureSuite({ positiveCount: 4, negativeCount: 3 });
  const historical = suite.items;

  it("no issues when nothing changed", () => {
    expect(checkItemImmutability(suite.items, historical)).toEqual([]);
  });

  it("flags an item edited in place", () => {
    const [first, ...rest] = suite.items;
    if (first === undefined) throw new Error("expected an item");
    const edited: Item = { ...first, scenario: "a completely different scenario text" };
    const violations = checkItemImmutability([edited, ...rest], historical);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "item-edited-in-place", itemId: first.id });
  });

  it("allows RETIRING an item (adding a retired block on top of otherwise-unchanged fields)", () => {
    const [first, ...rest] = suite.items;
    if (first === undefined) throw new Error("expected an item");
    const retired: Item = { ...first, retired: { at: "2026-09-01", reason: "artifact deleted upstream" } };
    const violations = checkItemImmutability([retired, ...rest], historical);
    expect(violations).toEqual([]);
  });

  it("flags an item removed entirely rather than retired", () => {
    const [, ...rest] = suite.items;
    const violations = checkItemImmutability(rest, historical);
    expect(violations.some((v) => v.code === "item-removed")).toBe(true);
  });

  it("a NEW item (no historical counterpart) is never flagged", () => {
    const newItem: Item = {
      id: "brand-new-item",
      probe: "activation",
      polarity: "positive",
      registeredAt: "2026-09-01",
      scenario: "something new",
      expect: { scorer: "no-tool-called" },
    };
    const violations = checkItemImmutability([...suite.items, newItem], historical);
    expect(violations).toEqual([]);
  });
});
