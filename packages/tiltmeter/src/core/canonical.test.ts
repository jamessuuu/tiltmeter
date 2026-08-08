import { describe, expect, it } from "vitest";
import { canonicalStringify, jcsCanonical } from "./canonical.js";

describe("canonicalStringify", () => {
  it("sorts object keys at every depth", () => {
    const out = canonicalStringify({ b: 1, a: { d: 2, c: 3 } });
    expect(out).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
  });

  it("uses 2-space indent, LF endings, and a trailing newline", () => {
    const out = canonicalStringify({ x: [1, 2] });
    expect(out.endsWith("\n")).toBe(true);
    expect(out).not.toContain("\r");
    expect(out).toBe('{\n  "x": [\n    1,\n    2\n  ]\n}\n');
  });

  it("preserves array order (not sorted)", () => {
    const out = canonicalStringify([3, 1, 2]);
    expect(out).toBe("[\n  3,\n  1,\n  2\n]\n");
  });

  it("round-trips through JSON.parse", () => {
    const value = { z: 1, a: [1, "two", null, true, false, { nested: 1 }] };
    const out = canonicalStringify(value);
    expect(JSON.parse(out)).toEqual(value);
  });

  it("drops keys whose value is undefined (consistent with JSON.stringify)", () => {
    const out = canonicalStringify({ a: 1, b: undefined });
    expect(out).toBe('{\n  "a": 1\n}\n');
  });

  it("throws on undefined inside an array rather than silently coercing to null", () => {
    expect(() => canonicalStringify([1, undefined, 3])).toThrow(/undefined in array/);
  });

  it("throws on a non-finite number", () => {
    expect(() => canonicalStringify({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalStringify({ a: Number.NaN })).toThrow(/non-finite/);
  });

  it("is byte-stable on re-serialization (idempotent through JSON.parse)", () => {
    const value = { a: 1, b: { c: [1, 2, 3], d: "text" } };
    const once = canonicalStringify(value);
    const twice = canonicalStringify(JSON.parse(once) as unknown);
    expect(twice).toBe(once);
  });
});

describe("jcsCanonical", () => {
  it("is compact (no whitespace) with sorted keys", () => {
    expect(jcsCanonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("differs from canonicalStringify only in whitespace, not content", () => {
    const value = { b: [1, 2], a: "x" };
    expect(JSON.parse(jcsCanonical(value)) as unknown).toEqual(JSON.parse(canonicalStringify(value)) as unknown);
  });

  it("is sensitive to key order at the value level (i.e. it isn't) — same object, any input key order, same output", () => {
    expect(jcsCanonical({ a: 1, b: 2 })).toBe(jcsCanonical({ b: 2, a: 1 }));
  });
});
