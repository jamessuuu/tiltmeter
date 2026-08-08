/**
 * `tiltmeter init` (SPEC §7/§14 M8): "scaffolds a suite from real artifacts
 * (snapgauge snapshots carry tool schemas — free interop)." This is the
 * scaffolding path that makes tiltmeter a tool other people can point at
 * THEIR harness rather than a private observatory — CLI wiring only;
 * `core/scaffold.ts` builds the suite, `node/artifact-sources.ts` reads
 * the input, `node/observatory.ts`'s `*IfMissing` helpers write the
 * generic templates (panel/pricing/presentation) alongside it.
 *
 * Never spends (SPEC §7's CLI table: "no" under Spends?) — no network, no
 * key, works from a clean clone (SPEC §14 M8's own gate: `init` + `lint` +
 * `plan --offline` from nothing but the npm-installed package).
 */
import { join, resolve } from "node:path";
import {
  buildSkillActivationSuite,
  buildToolSelectionSuite,
  SCAFFOLD_PANEL,
  SCAFFOLD_PRICING_MANIFEST,
  SCAFFOLD_SKILL_TOOL_PRESENTATION,
  SCAFFOLD_TOOL_SELECT_PRESENTATION,
  type ScaffoldToolInput,
} from "../../core/scaffold.js";
import type { Presentation } from "../../core/presentation.js";
import type { Suite } from "../../core/suite.js";
import { readSkillsFromDir, readToolsFromJsonFile } from "../../node/artifact-sources.js";
import { suiteExists, writePanelIfMissing, writePresentationIfMissing, writePricingManifestIfMissing, writeSuite } from "../../node/observatory.js";
import type { CliIo } from "../run.js";
import { CLI_EXIT } from "../exit-codes.js";

export interface InitCommandOptions {
  fromSkills: string | undefined;
  fromMcp: string | undefined;
  fromSnapgauge: string | undefined;
  suiteId: string | undefined;
}

export interface InitCommandDeps {
  cwd: string;
  now: () => string;
}

interface ResolvedSource {
  suite: Suite;
  presentation: Presentation;
  summary: string;
}

function resolveFromSkills(io: CliIo, dirArg: string, deps: InitCommandDeps, suiteId: string, registeredAt: string): ResolvedSource | number {
  const dirPath = resolve(deps.cwd, dirArg);
  const { skills, skipped } = readSkillsFromDir(dirPath);
  if (skills.length === 0) {
    io.stderr(`tiltmeter init: no skills found under "${dirArg}" (expected <dir>/<skill-name>/SKILL.md, each with YAML frontmatter carrying name/description)`);
    return CLI_EXIT.USAGE;
  }
  const suite = buildSkillActivationSuite(skills, { id: suiteId, registeredAt });
  const skippedNote = skipped.length > 0 ? ` (skipped ${String(skipped.length)}: ${skipped.map((s) => `${s.dir} — ${s.reason}`).join("; ")})` : "";
  return { suite, presentation: SCAFFOLD_SKILL_TOOL_PRESENTATION, summary: `${String(skills.length)} skill(s) from "${dirArg}"${skippedNote}` };
}

function resolveFromTools(io: CliIo, fileArg: string, deps: InitCommandDeps, suiteId: string, registeredAt: string, sourceLabel: string): ResolvedSource | number {
  const filePath = resolve(deps.cwd, fileArg);
  let tools: ScaffoldToolInput[];
  try {
    tools = readToolsFromJsonFile(filePath);
  } catch (error) {
    io.stderr(`tiltmeter init: ${error instanceof Error ? error.message : String(error)}`);
    return CLI_EXIT.USAGE;
  }
  if (tools.length === 0) {
    io.stderr(`tiltmeter init: no usable tool schemas found in "${fileArg}" (expected a JSON array of tools, or {"tools": [...]}, each with a name and an input_schema/inputSchema)`);
    return CLI_EXIT.USAGE;
  }
  const suite = buildToolSelectionSuite(tools, { id: suiteId, registeredAt });
  return { suite, presentation: SCAFFOLD_TOOL_SELECT_PRESENTATION, summary: `${String(tools.length)} tool(s) from ${sourceLabel} "${fileArg}"` };
}

export function runInitCommand(io: CliIo, options: InitCommandOptions, deps: InitCommandDeps): number {
  const given = [options.fromSkills, options.fromMcp, options.fromSnapgauge].filter((s) => s !== undefined);
  if (given.length !== 1) {
    io.stderr("tiltmeter init: pass exactly one of --from-skills <dir>, --from-mcp <tools.json>, --from-snapgauge <snapshot.json>");
    return CLI_EXIT.USAGE;
  }

  const observatoryDir = join(deps.cwd, "observatory");
  const registeredAt = deps.now().slice(0, 10);

  const defaultSuiteId = options.fromSkills !== undefined ? "from-skills" : options.fromMcp !== undefined ? "from-mcp" : "from-snapgauge";
  const suiteId = options.suiteId ?? defaultSuiteId;

  if (suiteExists(observatoryDir, suiteId)) {
    io.stderr(
      `tiltmeter init: observatory/suites/${suiteId}.suite.json already exists — pass --suite-id to choose a different id ` +
        "(items are immutable; init never overwrites an existing suite file).",
    );
    return CLI_EXIT.USAGE;
  }

  const resolved =
    options.fromSkills !== undefined
      ? resolveFromSkills(io, options.fromSkills, deps, suiteId, registeredAt)
      : options.fromMcp !== undefined
        ? resolveFromTools(io, options.fromMcp, deps, suiteId, registeredAt, "the tools file")
        : resolveFromTools(io, options.fromSnapgauge ?? "", deps, suiteId, registeredAt, "the snapgauge snapshot");
  if (typeof resolved === "number") return resolved;
  const { suite, presentation, summary } = resolved;

  const wrotePanel = writePanelIfMissing(observatoryDir, SCAFFOLD_PANEL);
  const wrotePricing = writePricingManifestIfMissing(observatoryDir, SCAFFOLD_PRICING_MANIFEST);
  const wrotePresentation = writePresentationIfMissing(observatoryDir, presentation);
  writeSuite(observatoryDir, suite);

  const positiveCount = suite.items.filter((i) => i.polarity === "positive").length;
  const negativeCount = suite.items.filter((i) => i.polarity === "negative").length;

  io.stdout(`tiltmeter init: wrote observatory/suites/${suite.id}.suite.json from ${summary}`);
  io.stdout(`  ${String(positiveCount)} positive item(s) — each scenario is a TODO placeholder; replace before this suite means anything`);
  io.stdout(`  ${String(negativeCount)} negative item(s) — generic distractor prompts, usable as committed`);
  if (wrotePanel) io.stdout("  also wrote observatory/panel.json (a minimal Haiku-only default — edit to match your real panel)");
  if (wrotePricing) io.stdout(`  also wrote observatory/pricing/${SCAFFOLD_PRICING_MANIFEST.id}.json (a bundled snapshot — re-verify rates before trusting a non-offline estimate)`);
  if (wrotePresentation) io.stdout(`  also wrote observatory/presentations/${presentation.id}.json`);
  io.stdout("Next: edit the TODO scenarios in the new suite file, then run `tiltmeter lint` and `tiltmeter plan --offline`.");
  return CLI_EXIT.CLEAN;
}
