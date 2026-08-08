/**
 * `tiltmeter init` end to end (SPEC §7/§14 M8) — through the REAL CLI
 * program (`runCli`), exercising exactly the gate SPEC §14 M8 names:
 * `init` then `lint` then `plan --offline`, from a clean temp directory
 * with nothing in it beforehand (mirrors what the tarball smoke test does
 * against the packed, npm-installed CLI — see scripts/pack-check.mjs).
 * No key, no network anywhere in this file.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLI_EXIT, runCli } from "../run.js";

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
}

const NOW = () => "2026-08-09T12:00:00.000Z";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tiltmeter-cli-init-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSkill(skillsRoot: string, name: string, description: string): void {
  const skillDir = join(skillsRoot, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`);
}

describe("tiltmeter init --from-skills", () => {
  it("SPEC §14 M8 gate: init + lint + plan --offline all succeed from a clean directory with no key", async () => {
    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution for design. Load before designing anything.");
    writeSkill(skillsRoot, "retro", "Self-improvement engine for the agent ecosystem.");

    const init = makeIo();
    const initCode = await runCli(["init", "--from-skills", "skills"], init.io, { cwd: dir, env: {} }, { now: NOW });
    expect(initCode).toBe(CLI_EXIT.CLEAN);
    expect(init.out.some((l) => l.includes("from-skills.suite.json"))).toBe(true);

    const lint = makeIo();
    const lintCode = await runCli(["lint"], lint.io, { cwd: dir, env: {} }, { now: NOW });
    expect(lintCode).toBe(CLI_EXIT.CLEAN);

    const plan = makeIo();
    const planCode = await runCli(["plan", "--run-group", "rg-1", "--offline"], plan.io, { cwd: dir, env: {} }, { now: NOW });
    expect(planCode).toBe(CLI_EXIT.CLEAN);
    expect(readFileSync(join(dir, "observatory", "readings", "rg-1", "plan.json"), "utf8")).toContain("from-skills");
  });

  it("also scaffolds panel.json, a pricing manifest, and the skill-tool@1 presentation", async () => {
    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    const { io } = makeIo();
    await runCli(["init", "--from-skills", "skills"], io, { cwd: dir, env: {} }, { now: NOW });

    const panel = JSON.parse(readFileSync(join(dir, "observatory", "panel.json"), "utf8")) as { entries: { role: string }[] };
    expect(panel.entries.some((e) => e.role === "null")).toBe(true);
    const presentation = JSON.parse(readFileSync(join(dir, "observatory", "presentations", "skill-tool@1.json"), "utf8")) as { id: string };
    expect(presentation.id).toBe("skill-tool@1");
  });

  it("refuses when zero or more than one --from-* flag is given", async () => {
    const none = makeIo();
    expect(await runCli(["init"], none.io, { cwd: dir, env: {} }, { now: NOW })).toBe(CLI_EXIT.USAGE);

    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    const both = makeIo();
    const code = await runCli(
      ["init", "--from-skills", "skills", "--from-mcp", "tools.json"],
      both.io,
      { cwd: dir, env: {} },
      { now: NOW },
    );
    expect(code).toBe(CLI_EXIT.USAGE);
  });

  it("refuses when no skills are found under the directory", async () => {
    mkdirSync(join(dir, "empty-skills"));
    const { io, err } = makeIo();
    const code = await runCli(["init", "--from-skills", "empty-skills"], io, { cwd: dir, env: {} }, { now: NOW });
    expect(code).toBe(CLI_EXIT.USAGE);
    expect(err.some((l) => l.includes("no skills found"))).toBe(true);
  });

  it("refuses to overwrite an already-existing suite id, never clobbers", async () => {
    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    const first = makeIo();
    await runCli(["init", "--from-skills", "skills"], first.io, { cwd: dir, env: {} }, { now: NOW });

    const second = makeIo();
    const code = await runCli(["init", "--from-skills", "skills"], second.io, { cwd: dir, env: {} }, { now: NOW });
    expect(code).toBe(CLI_EXIT.USAGE);
    expect(second.err.some((l) => l.includes("already exists"))).toBe(true);
  });

  it("--suite-id overrides the default id", async () => {
    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    const { io, out } = makeIo();
    const code = await runCli(["init", "--from-skills", "skills", "--suite-id", "my-suite"], io, { cwd: dir, env: {} }, { now: NOW });
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(out.some((l) => l.includes("my-suite.suite.json"))).toBe(true);
    readFileSync(join(dir, "observatory", "suites", "my-suite.suite.json"), "utf8"); // throws if missing
  });

  it("never overwrites an existing panel.json — a project's real panel survives a second init from a different source", async () => {
    const customPanel = { formatVersion: 1, id: "custom", entries: [{ cellId: "x", modelIdRequested: "claude-sonnet-5", role: "standing" }, { cellId: "x-null", modelIdRequested: "claude-sonnet-5", role: "null" }] };
    mkdirSync(join(dir, "observatory"), { recursive: true });
    writeFileSync(join(dir, "observatory", "panel.json"), JSON.stringify(customPanel));

    const skillsRoot = join(dir, "skills");
    writeSkill(skillsRoot, "taste", "Anti-slop constitution.");
    const { io } = makeIo();
    await runCli(["init", "--from-skills", "skills"], io, { cwd: dir, env: {} }, { now: NOW });

    const stillCustom = JSON.parse(readFileSync(join(dir, "observatory", "panel.json"), "utf8")) as { id: string };
    expect(stillCustom.id).toBe("custom");
  });
});

describe("tiltmeter init --from-mcp", () => {
  it("SPEC §14 M8 gate: init + lint + plan --offline all succeed", async () => {
    writeFileSync(
      join(dir, "tools.json"),
      JSON.stringify({
        tools: [
          { name: "resolve-library-id", description: "Resolve a package name to a library ID.", inputSchema: { type: "object", properties: {} } },
          { name: "get-docs", description: "Fetch documentation.", inputSchema: { type: "object", properties: {} } },
        ],
      }),
    );

    const init = makeIo();
    expect(await runCli(["init", "--from-mcp", "tools.json"], init.io, { cwd: dir, env: {} }, { now: NOW })).toBe(CLI_EXIT.CLEAN);

    const lint = makeIo();
    expect(await runCli(["lint"], lint.io, { cwd: dir, env: {} }, { now: NOW })).toBe(CLI_EXIT.CLEAN);

    const plan = makeIo();
    expect(await runCli(["plan", "--run-group", "rg-1", "--offline"], plan.io, { cwd: dir, env: {} }, { now: NOW })).toBe(CLI_EXIT.CLEAN);
  });
});

describe("tiltmeter init --from-snapgauge", () => {
  it("SPEC §14 M8 gate: init + lint + plan --offline all succeed from a snapgauge-shaped snapshot", async () => {
    writeFileSync(
      join(dir, "snapshot.json"),
      JSON.stringify({
        formatVersion: 1,
        recordedAt: "2026-08-09T00:00:00Z",
        tools: [
          { name: "record", description: "Record a snapshot.", inputSchema: { type: "object", properties: {} } },
          { name: "diff", description: "Diff two snapshots.", inputSchema: { type: "object", properties: {} } },
        ],
      }),
    );

    const init = makeIo();
    const code = await runCli(["init", "--from-snapgauge", "snapshot.json"], init.io, { cwd: dir, env: {} }, { now: NOW });
    expect(code).toBe(CLI_EXIT.CLEAN);
    expect(init.out.some((l) => l.includes("from-snapgauge.suite.json"))).toBe(true);

    const lint = makeIo();
    expect(await runCli(["lint"], lint.io, { cwd: dir, env: {} }, { now: NOW })).toBe(CLI_EXIT.CLEAN);

    const plan = makeIo();
    expect(await runCli(["plan", "--run-group", "rg-1", "--offline"], plan.io, { cwd: dir, env: {} }, { now: NOW })).toBe(CLI_EXIT.CLEAN);
  });
});
