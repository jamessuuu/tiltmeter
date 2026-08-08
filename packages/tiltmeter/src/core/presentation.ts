/**
 * Presentation (SPEC §7): "A committed template: system-block layout, how
 * an artifact of each `kind` is rendered … tool_choice policy, and stop
 * conditions. Hashed into the axis tuple. Changing it invalidates
 * comparison — deliberately."
 *
 * `skill-tool@1` (SPEC §14 M1) renders:
 *  - every `skill-description` artifact into one entry of a `Skill` tool's
 *    enum, mirroring Claude Code's real shape (a listing of "- name:
 *    description" in the tool description, `skill` as an enum input);
 *  - every `tool-schema` artifact into a `tools[]` entry, verbatim.
 *
 * Deviation from a literal per-item reading of `artifactRefs`: the Skill
 * tool's enum is built from EVERY active (non-retired) skill-description
 * artifact in the suite, not just the ones an item's `artifactRefs` names.
 * That is what makes the `activation` probe meaningful — a router only
 * proves it discriminates correctly when the full catalog is on offer, and
 * a negative item with an empty `artifactRefs` still needs a non-empty
 * enum to test "stay quiet". `artifactRefs` is retained as provenance
 * metadata (SPEC §3.1 Decision 1 retirement reporting), not a request
 * filter.
 */
import { z } from "zod";
import type { Artifact, Item, Suite } from "./suite.js";
import { activeItems } from "./suite.js";
import type { RequestPlan, ToolDef } from "./model-client.js";
import { jcsCanonical } from "./canonical.js";
import { sha256Hex } from "./sha256.js";

export const ToolChoiceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auto") }),
  z.object({ type: z.literal("any") }),
  z.object({ type: z.literal("tool"), name: z.string().min(1) }),
]);

export const PresentationSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string().min(1),
  system: z.string(),
  toolChoice: ToolChoiceSchema,
  skillToolName: z.string().min(1),
  skillToolDescriptionHeader: z.string(),
});
export type Presentation = z.infer<typeof PresentationSchema>;

export function parsePresentation(data: unknown): Presentation {
  return PresentationSchema.parse(data);
}

/** SPEC §4 axis tuple element: hashed into every reading. */
export function presentationHash(presentation: Presentation): string {
  return sha256Hex(jcsCanonical(presentation));
}

/** SPEC §4 axis tuple element: the sampling policy actually applied for a run. */
export function samplingPolicyHash(sampling: Suite["sampling"]): string {
  return sha256Hex(jcsCanonical(sampling));
}

type SkillDescriptionArtifact = Extract<Artifact, { kind: "skill-description" }>;
type ToolSchemaArtifact = Extract<Artifact, { kind: "tool-schema" }>;

function skillDescriptionArtifacts(artifacts: Artifact[]): SkillDescriptionArtifact[] {
  return artifacts.filter((a): a is SkillDescriptionArtifact => a.kind === "skill-description");
}

function toolSchemaArtifacts(artifacts: Artifact[]): ToolSchemaArtifact[] {
  return artifacts.filter((a): a is ToolSchemaArtifact => a.kind === "tool-schema");
}

function buildSkillTool(presentation: Presentation, artifacts: Artifact[]): ToolDef | undefined {
  const skills = skillDescriptionArtifacts(artifacts);
  if (skills.length === 0) return undefined;
  const names: string[] = [];
  const lines: string[] = [presentation.skillToolDescriptionHeader];
  for (const artifact of skills) {
    const { name, description } = artifact.materialized;
    names.push(name);
    lines.push(`- ${name}: ${description}`);
  }
  return {
    name: presentation.skillToolName,
    description: lines.join("\n"),
    input_schema: {
      type: "object",
      properties: {
        skill: { type: "string", enum: names },
      },
      required: ["skill"],
    },
  };
}

function buildVerbatimTools(artifacts: Artifact[]): ToolDef[] {
  return toolSchemaArtifacts(artifacts).map((artifact): ToolDef => {
    const { name, description, input_schema } = artifact.materialized;
    // exactOptionalPropertyTypes: only set `description` when present —
    // `{ description: undefined }` is not the same as an absent key.
    return description === undefined ? { name, input_schema } : { name, description, input_schema };
  });
}

function buildTools(presentation: Presentation, artifacts: Artifact[]): ToolDef[] {
  const skillTool = buildSkillTool(presentation, artifacts);
  const verbatim = buildVerbatimTools(artifacts);
  return skillTool === undefined ? verbatim : [skillTool, ...verbatim];
}

function renderItem(presentation: Presentation, suite: Suite, tools: ToolDef[], item: Item): RequestPlan {
  return {
    itemId: item.id,
    system: presentation.system,
    tools,
    toolChoice: presentation.toolChoice,
    messages: [{ role: "user", content: item.scenario }],
    maxTokens: suite.sampling.maxTokens,
    temperature: suite.sampling.temperature,
  };
}

/** Render every active item in the suite into a `RequestPlan` (SPEC §6 module map). */
export function renderPresentation(suite: Suite, presentation: Presentation): RequestPlan[] {
  const tools = buildTools(presentation, suite.artifacts);
  return activeItems(suite).map((item) => renderItem(presentation, suite, tools, item));
}
