import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256.js";

describe("sha256Hex", () => {
  // FIPS 180-4 test vectors.
  it("hashes the empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it('hashes "abc"', () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes a two-block message", () => {
    const input = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(sha256Hex(input)).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("cross-checks against node:crypto for a 1,000,000-char input", () => {
    const input = "a".repeat(1_000_000);
    const expected = createHash("sha256").update(input).digest("hex");
    expect(sha256Hex(input)).toBe(expected);
  });

  it("cross-checks against node:crypto for arbitrary UTF-8 input", () => {
    const input = "tiltmeter §4 axis tuple — 日本語 test 🎯";
    const expected = createHash("sha256").update(input, "utf8").digest("hex");
    expect(sha256Hex(input)).toBe(expected);
  });

  it("is deterministic and sensitive to every byte", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
    expect(sha256Hex("a")).toBe(sha256Hex("a"));
  });
});
