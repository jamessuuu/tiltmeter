/**
 * Suite schema (SPEC §3.1) — the pre-registered artifact. Zod at every
 * boundary (SPEC §13): a suite file is validated on read, never trusted.
 *
 * Scope note (deviation, recorded in CHANGELOG): SPEC §3.2 lists five probe
 * types and eight scorer kinds across the whole v1 surface. M1 implements
 * exactly the three scorers its gate needs — `tool-called`, `no-tool-called`,
 * `tool-in-set` — so `ExpectSchema` is a discriminated union of those three
 * for now. The remaining scorer kinds (`arg-enum`, `arg-required-keys`,
 * `tool-order`, `literal-prefix`, `json-schema-valid`) are additive and land
 * with the real observatory suites at M4/M5; adding a union member here is a
 * non-breaking schema change and does not retroactively invalidate anything
 * hashed under `suiteSpecHash` for suites that never reference them.
 */
import { z } from "zod";
import { jcsCanonical } from "./canonical.js";
import { sha256Hex } from "./sha256.js";

/** SPEC §3.2 probe taxonomy. Declared in full even though M1 only scores `activation`-shaped items. */
export const ProbeTypeSchema = z.enum([
  "activation",
  "tool-selection",
  "instruction-adherence",
  "output-format",
  "refusal-shape",
]);
export type ProbeType = z.infer<typeof ProbeTypeSchema>;

export const PolaritySchema = z.enum(["positive", "negative"]);
export type Polarity = z.infer<typeof PolaritySchema>;

/** SPEC §3.1 Decision 1: an artifact's provenance level is never optional — guessing is not permitted. */
export const ArtifactSourceSchema = z.discriminatedUnion("origin", [
  z.object({
    origin: z.literal("public"),
    repo: z.string(),
    commit: z.string(),
    blobSha: z.string(),
    path: z.string(),
    field: z.string(),
    capturedAt: z.string(),
  }),
  z.object({
    origin: z.literal("private"),
    repo: z.null(),
    path: z.string(),
    field: z.string(),
    capturedAt: z.string(),
  }),
]);
export type ArtifactSource = z.infer<typeof ArtifactSourceSchema>;

/** SPEC §7: a `skill-description` artifact renders into one `Skill`-tool enum entry. */
export const SkillDescriptionMaterializedSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
});
export type SkillDescriptionMaterialized = z.infer<typeof SkillDescriptionMaterializedSchema>;

/** SPEC §7: a `tool-schema` artifact renders into a `tools[]` entry, verbatim. */
export const ToolSchemaMaterializedSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()),
});
export type ToolSchemaMaterialized = z.infer<typeof ToolSchemaMaterializedSchema>;

/** `materialized` is the exact text/shape sent to the model — committed so a reading reproduces forever. */
export const ArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("skill-description"),
    source: ArtifactSourceSchema,
    materialized: SkillDescriptionMaterializedSchema,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("tool-schema"),
    source: ArtifactSourceSchema,
    materialized: ToolSchemaMaterializedSchema,
  }),
]);
export type Artifact = z.infer<typeof ArtifactSchema>;

const ArgsSubsetSchema = z.record(z.string(), z.unknown());

export const ExpectSchema = z.discriminatedUnion("scorer", [
  z.object({
    scorer: z.literal("tool-called"),
    name: z.string().min(1),
    args: ArgsSubsetSchema.optional(),
  }),
  z.object({
    scorer: z.literal("no-tool-called"),
  }),
  z.object({
    scorer: z.literal("tool-in-set"),
    names: z.array(z.string().min(1)).min(1),
  }),
]);
export type Expect = z.infer<typeof ExpectSchema>;

export const RetirementSchema = z.object({
  at: z.string(),
  reason: z.string().min(1),
});
export type Retirement = z.infer<typeof RetirementSchema>;

/**
 * SPEC §3.1 Decision 2: items are immutable; a "retired" item keeps its
 * original fields (so its canonical bytes are still checkable against the
 * last published reading) and gains a `retired` block. Suites grow by
 * retirement, never by in-place edit.
 */
export const ItemSchema = z.object({
  id: z.string().min(1),
  probe: ProbeTypeSchema,
  polarity: PolaritySchema,
  artifactRefs: z.array(z.string().min(1)).optional(),
  registeredAt: z.string().min(1),
  scenario: z.string().min(1),
  expect: ExpectSchema,
  retired: RetirementSchema.optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const SamplingSchema = z.object({
  k: z.number().int().positive(),
  temperature: z.number().min(0),
  maxTokens: z.number().int().positive(),
});
export type Sampling = z.infer<typeof SamplingSchema>;

export const SuiteSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string().min(1),
  presentation: z.string().min(1),
  /** Free prose. The ONLY field excluded from suiteSpecHash (SPEC §3.1 Decision 3). */
  docs: z.string().optional(),
  metrics: z.array(z.string().min(1)).min(1),
  sampling: SamplingSchema,
  artifacts: z.array(ArtifactSchema),
  items: z.array(ItemSchema).min(1),
});
export type Suite = z.infer<typeof SuiteSchema>;

export function parseSuite(data: unknown): Suite {
  return SuiteSchema.parse(data);
}

/**
 * SPEC §3.1 Decision 3: sha256 of the canonicalized suite file with only
 * `docs` excluded. Everything that can change behavior or scoring
 * (including retirements and sampling policy) is inside the hash.
 */
export function suiteSpecHash(suite: Suite): string {
  const { docs: _docs, ...rest } = suite;
  return sha256Hex(jcsCanonical(rest));
}

/** Active (non-retired) items — what a run actually executes. */
export function activeItems(suite: Suite): Item[] {
  return suite.items.filter((item) => item.retired === undefined);
}

/** Negatives quota check (SPEC §3.2): `negatives >= max(3, 20% of active items)`. Pure predicate; lint (M5) calls this. */
export function meetsNegativesQuota(suite: Suite): boolean {
  const active = activeItems(suite);
  const negatives = active.filter((item) => item.polarity === "negative").length;
  const minRequired = Math.max(3, Math.ceil(active.length * 0.2));
  return negatives >= minRequired;
}
