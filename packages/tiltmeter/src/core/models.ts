/**
 * `observatory/models.json` (SPEC §10 `/models`, §7 `verify`'s
 * pre-registration proof): panel entries with a CITED release date and
 * source URL — "reads `models.json` for the model's `releasedAt` plus a
 * cited source URL." `releasedAt` is keyed by the REQUESTED (alias) model
 * id, e.g. `"claude-haiku-4-5"`, not a dated snapshot id — the release
 * event is a model-FAMILY announcement, not a specific resolved snapshot
 * build, and `axes.modelIdRequested` (not `modelIdResolved`) is what a
 * suite/panel actually names.
 */
import { z } from "zod";

export const ModelStatusSchema = z.enum(["standing", "release-only", "retired"]);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ModelEntrySchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  /** ISO date (`YYYY-MM-DD`) the model family was announced/released. */
  releasedAt: z.string().min(1),
  /** The cited source — SPEC §7: "a cited source URL." */
  sourceUrl: z.string().min(1),
  status: ModelStatusSchema,
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelsSchema = z.object({
  formatVersion: z.literal(1),
  models: z.array(ModelEntrySchema).min(1),
});
export type Models = z.infer<typeof ModelsSchema>;

export function parseModels(data: unknown): Models {
  return ModelsSchema.parse(data);
}

export function findModelEntry(models: Models, modelId: string): ModelEntry | undefined {
  return models.models.find((m) => m.modelId === modelId);
}
