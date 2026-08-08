import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSkillMdFrontmatter, readSkillsFromDir, readToolsFromJsonFile } from "./artifact-sources.js";

describe("parseSkillMdFrontmatter", () => {
  it("parses the real ~/.claude/skills/*/SKILL.md shape", () => {
    const text = "---\nname: taste\ndescription: Anti-slop constitution for design.\n---\n\n# Taste\n\nBody text.\n";
    expect(parseSkillMdFrontmatter(text)).toEqual({ name: "taste", description: "Anti-slop constitution for design." });
  });

  it("handles CRLF line endings", () => {
    const text = "---\r\nname: taste\r\ndescription: Something.\r\n---\r\nBody\r\n";
    expect(parseSkillMdFrontmatter(text)).toEqual({ name: "taste", description: "Something." });
  });

  it("throws a clear error when there is no frontmatter block at all", () => {
    expect(() => parseSkillMdFrontmatter("# Just a heading\n")).toThrow(/frontmatter/i);
  });

  it("throws when name is missing", () => {
    expect(() => parseSkillMdFrontmatter("---\ndescription: only a description\n---\n")).toThrow(/name/);
  });

  it("throws when description is missing", () => {
    expect(() => parseSkillMdFrontmatter("---\nname: only-a-name\n---\n")).toThrow(/description/);
  });
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tiltmeter-artifact-sources-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSkill(skillsRoot: string, name: string, description: string): void {
  const skillDir = join(skillsRoot, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`);
}

describe("readSkillsFromDir", () => {
  it("reads every <skill>/SKILL.md under the directory, sorted, with a relative sourcePath", () => {
    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    writeSkill(skillsRoot, "retro", "Self-improvement engine.");
    const { skills, skipped } = readSkillsFromDir(skillsRoot);
    expect(skipped).toEqual([]);
    expect(skills).toHaveLength(2);
    const taste = skills.find((s) => s.name === "taste");
    expect(taste?.sourcePath).toBe("skills/taste/SKILL.md");
  });

  it("skips a subdirectory with no SKILL.md, reporting why, rather than throwing", () => {
    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    mkdirSync(join(skillsRoot, "not-a-skill"), { recursive: true });
    const { skills, skipped } = readSkillsFromDir(skillsRoot);
    expect(skills).toHaveLength(1);
    expect(skipped).toEqual([{ dir: "not-a-skill", reason: "no SKILL.md" }]);
  });

  it("skips a SKILL.md that fails to parse, reporting why, rather than aborting the whole scan", () => {
    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    mkdirSync(join(skillsRoot, "broken"), { recursive: true });
    writeFileSync(join(skillsRoot, "broken", "SKILL.md"), "not frontmatter at all\n");
    const { skills, skipped } = readSkillsFromDir(skillsRoot);
    expect(skills).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.dir).toBe("broken");
  });

  it("empty result (not a throw) for a directory that does not exist", () => {
    expect(readSkillsFromDir(join(dir, "does-not-exist"))).toEqual({ skills: [], skipped: [] });
  });

  it("ignores plain files sitting alongside skill directories", () => {
    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    writeFileSync(join(skillsRoot, "README.md"), "not a skill directory\n");
    const { skills } = readSkillsFromDir(skillsRoot);
    expect(skills).toHaveLength(1);
  });
});

describe("readToolsFromJsonFile", () => {
  it("reads a bare array of tools (Anthropic wire shape: input_schema)", () => {
    const filePath = join(dir, "tools.json");
    writeFileSync(
      filePath,
      JSON.stringify([{ name: "get_weather", description: "Get the weather.", input_schema: { type: "object" } }]),
    );
    const tools = readToolsFromJsonFile(filePath);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "get_weather", description: "Get the weather." });
  });

  it("reads a { tools: [...] } wrapper (MCP tools/list shape: inputSchema)", () => {
    const filePath = join(dir, "mcp-tools.json");
    writeFileSync(filePath, JSON.stringify({ tools: [{ name: "search", inputSchema: { type: "object" } }] }));
    const tools = readToolsFromJsonFile(filePath);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("search");
    expect(tools[0]?.description).toBeUndefined();
  });

  it("reads a snapgauge-shaped snapshot ({ formatVersion, tools: [...] }, inputSchema camelCase)", () => {
    const filePath = join(dir, "snapshot.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        formatVersion: 1,
        recordedAt: "2026-08-09T00:00:00Z",
        tools: [
          { name: "resolve-library-id", description: "Resolve a library.", inputSchema: { type: "object", properties: {} } },
          { name: "query-docs", inputSchema: { type: "object" } },
        ],
      }),
    );
    const tools = readToolsFromJsonFile(filePath);
    expect(tools.map((t) => t.name).sort()).toEqual(["query-docs", "resolve-library-id"]);
  });

  it("drops entries missing a usable name or schema rather than throwing", () => {
    const filePath = join(dir, "mixed.json");
    writeFileSync(
      filePath,
      JSON.stringify([
        { name: "good", input_schema: { type: "object" } },
        { description: "no name field" },
        { name: "no-schema" },
        { name: "", input_schema: { type: "object" } },
      ]),
    );
    const tools = readToolsFromJsonFile(filePath);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("good");
  });

  it("throws a clear error when the file is neither an array nor { tools: [...] }", () => {
    const filePath = join(dir, "bad-shape.json");
    writeFileSync(filePath, JSON.stringify({ notTools: [] }));
    expect(() => readToolsFromJsonFile(filePath)).toThrow(/expected a JSON array/);
  });
});
