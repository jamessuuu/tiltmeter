/**
 * Canonical JSON (SPEC §3.3: "keys sorted, 2-space, LF, trailing newline —
 * matches snapgauge, so the whole program diffs the same").
 *
 * - `canonicalStringify` is the on-disk format for every committed JSON
 *   file this project writes: suites, presentations, readings, the
 *   readings/index.json hash chain. Sorted keys at every depth, 2-space
 *   indent, LF endings, trailing newline — legible in `git diff`.
 * - `jcsCanonical` is the compact sorted form hashes are computed over
 *   (suiteSpecHash, presentationHash, samplingPolicyHash, bodyHash). For
 *   JSON-safe data serialized under ECMAScript `JSON.stringify` number
 *   rules, sorted-keys-compact is RFC 8785-equivalent.
 *
 * Both take `unknown` and validate while walking: the serializer IS the
 * runtime Json check, and it fails loudly on values JSON cannot round-trip
 * (undefined in arrays, non-finite numbers, functions) because a silently
 * coerced value would change a hash or a committed file.
 */

import { z } from "zod";

// The object member must stay an inline literal: `Record<string, Json>`
// inside the alias's own union is a TS2456 circular reference.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = Record<string, Json>;

/** Runtime Json validation for boundaries (suite files, readings, index entries). */
export const JsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() =>
  z.record(z.string(), JsonValueSchema),
);

export function canonicalStringify(value: unknown): string {
  return `${serialize(value, true, 0, [])}\n`;
}

export function jcsCanonical(value: unknown): string {
  return serialize(value, false, 0, []);
}

function serialize(
  value: unknown,
  pretty: boolean,
  depth: number,
  path: (string | number)[],
): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonical json: non-finite number at ${formatPath(path)}`);
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        const items = value.map((v: unknown, i: number) => {
          if (v === undefined) {
            // JSON.stringify would coerce this to null and silently change a
            // hash / committed file — reject loudly instead.
            throw new TypeError(`canonical json: undefined in array at ${formatPath([...path, i])}`);
          }
          return serialize(v, pretty, depth + 1, [...path, i]);
        });
        if (items.length === 0) return "[]";
        if (!pretty) return `[${items.join(",")}]`;
        const pad = "  ".repeat(depth + 1);
        return `[\n${items.map((s) => pad + s).join(",\n")}\n${"  ".repeat(depth)}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const entries: string[] = [];
      for (const key of keys) {
        const v = record[key];
        if (v === undefined) continue; // absent, not null — consistent with JSON.stringify
        const serialized = serialize(v, pretty, depth + 1, [...path, key]);
        entries.push(
          pretty ? `${JSON.stringify(key)}: ${serialized}` : `${JSON.stringify(key)}:${serialized}`,
        );
      }
      if (entries.length === 0) return "{}";
      if (!pretty) return `{${entries.join(",")}}`;
      const pad = "  ".repeat(depth + 1);
      return `{\n${entries.map((s) => pad + s).join(",\n")}\n${"  ".repeat(depth)}}`;
    }
    default:
      throw new TypeError(`canonical json: unsupported ${typeof value} at ${formatPath(path)}`);
  }
}

function formatPath(path: (string | number)[]): string {
  return path.length === 0 ? "$" : `$.${path.join(".")}`;
}
