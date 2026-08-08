/**
 * `tiltmeter init`'s artifact readers (SPEC §7/§14 M8) — turning a
 * directory of real `SKILL.md` files, an MCP `tools/list`-shaped JSON file,
 * or a snapgauge snapshot into the plain `{name, description, ...}` shapes
 * `core/scaffold.ts` builds a suite from. Every function here touches `fs`
 * and is therefore `src/node/**`'s job (SPEC §6); `core/scaffold.ts` itself
 * never does.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import type { ScaffoldSkillInput, ScaffoldToolInput } from "../core/scaffold.js";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Parse a `SKILL.md`'s YAML frontmatter for `name`/`description` — the
 * exact shape every real skill on this machine already uses (e.g.
 * `~/.claude/skills/taste/SKILL.md`: `---\nname: taste\ndescription: ...\n---`).
 * Throws with a clear reason on a missing/malformed frontmatter block
 * rather than silently skipping it — the caller decides whether that's
 * fatal (a single bad file) or just a reported skip (`readSkillsFromDir`).
 */
export function parseSkillMdFrontmatter(text: string): { name: string; description: string } {
  const match = FRONTMATTER_PATTERN.exec(text);
  if (match === null) {
    throw new Error("no YAML frontmatter block (--- ... ---) found at the top of the file");
  }
  const frontmatterText = match[1];
  if (frontmatterText === undefined) throw new Error("unreachable — the regex's own capture group");
  const parsed: unknown = load(frontmatterText);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("frontmatter did not parse to a YAML mapping");
  }
  const record = parsed as Record<string, unknown>;
  const { name, description } = record;
  if (typeof name !== "string" || name.length === 0) throw new Error("frontmatter is missing a non-empty `name`");
  if (typeof description !== "string" || description.length === 0) throw new Error("frontmatter is missing a non-empty `description`");
  return { name, description };
}

export interface ReadSkillsResult {
  skills: ScaffoldSkillInput[];
  /** Immediate subdirectories that were skipped (no `SKILL.md`, or one that failed to parse) — surfaced so `init` can report them rather than silently dropping them. */
  skipped: { dir: string; reason: string }[];
}

/**
 * Walk `dir`'s immediate subdirectories, each expected to hold a
 * `SKILL.md` — the real, observed convention (`~/.claude/skills/<name>/SKILL.md`).
 * `sourcePath` on each result is `<dir's own basename>/<skill>/SKILL.md`
 * (relative, not absolute) so the recorded provenance path is legible in a
 * committed suite file without leaking wherever `init` happened to run
 * from on disk.
 */
export function readSkillsFromDir(dir: string): ReadSkillsResult {
  const skills: ScaffoldSkillInput[] = [];
  const skipped: { dir: string; reason: string }[] = [];
  const baseName = dir.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? dir;

  const entries = existsSync(dir) ? readdirSync(dir) : [];
  for (const entry of [...entries].sort()) {
    const entryPath = join(dir, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    const skillMdPath = join(entryPath, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      skipped.push({ dir: entry, reason: "no SKILL.md" });
      continue;
    }
    try {
      const text = readFileSync(skillMdPath, "utf8");
      const { name, description } = parseSkillMdFrontmatter(text);
      skills.push({ name, description, sourcePath: `${baseName}/${entry}/SKILL.md` });
    } catch (error) {
      skipped.push({ dir: entry, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { skills, skipped };
}

interface RawToolLike {
  name?: unknown;
  description?: unknown;
  input_schema?: unknown;
  inputSchema?: unknown;
}

function toScaffoldTool(raw: RawToolLike, sourceFileName: string): ScaffoldToolInput | undefined {
  if (typeof raw.name !== "string" || raw.name.length === 0) return undefined;
  const schema = raw.input_schema ?? raw.inputSchema;
  if (schema === null || typeof schema !== "object") return undefined;
  const inputSchema = schema as Record<string, unknown>;
  return typeof raw.description === "string" && raw.description.length > 0
    ? { name: raw.name, description: raw.description, inputSchema, sourcePath: sourceFileName }
    : { name: raw.name, inputSchema, sourcePath: sourceFileName };
}

/**
 * Accepts BOTH a bare array of tool-like objects and `{tools: [...]}` — an
 * MCP `tools/list` response shape, or a snapgauge snapshot's own `tools[]`
 * (SPEC §14 M8: "a snapgauge snapshot already carries tool schemas, so
 * --from-snapgauge should produce a tool-selection suite skeleton" — this
 * one reader serves both `--from-mcp` and `--from-snapgauge`, since their
 * input shapes are structurally the same modulo the wrapper). Accepts
 * both `input_schema` (Anthropic wire shape) and `inputSchema` (MCP/
 * snapgauge shape) per entry. Entries missing a usable `name`/schema are
 * silently dropped — diagnosing a malformed THIRD-PARTY export in detail
 * is not this tool's job; the caller reports how many were kept.
 */
export function readToolsFromJsonFile(filePath: string): ScaffoldToolInput[] {
  const text = readFileSync(filePath, "utf8");
  const parsed: unknown = JSON.parse(text);
  const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const rawList: unknown[] | undefined = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { tools?: unknown }).tools)
      ? (parsed as { tools: unknown[] }).tools
      : undefined;
  if (rawList === undefined) {
    throw new Error(`${filePath}: expected a JSON array of tools, or an object with a "tools" array`);
  }
  const tools: ScaffoldToolInput[] = [];
  for (const entry of rawList) {
    if (entry === null || typeof entry !== "object") continue;
    const tool = toScaffoldTool(entry, fileName);
    if (tool !== undefined) tools.push(tool);
  }
  return tools;
}
