// SPEC §8 M7 `release-watch.yml`: "daily; diffs the Anthropic models list
// against observatory/models.json and OPENS A PR adding the new model with
// its releasedAt + source URL. The PR is the human gate; merging it
// triggers a release run." This script does the DIFF and the FILE EDIT
// only — `release-watch.yml`'s own steps (peter-evans/create-pull-request)
// turn a changed observatory/models.json into an actual PR. Nothing here
// ever merges anything, and nothing here ever adds a model to
// observatory/panel.json (the standing/release panel) — that promotion
// from "known to models.json" to "actually run" is a SEPARATE, human,
// edit-panel.json step, even after this PR merges.
//
// Degrades cleanly without a key (SPEC §8 M7): the Models API needs
// authentication, so a missing ANTHROPIC_API_KEY is logged and this exits
// 0, not red — release-watch.yml runs daily whether or not the secret is
// configured yet.
//
// Honesty over automation: the Models API's `created_at` is a REGISTRATION
// date, not necessarily the public announcement date SPEC's `releasedAt`
// means — this script never claims otherwise. Every model it adds is
// written with `status: "release-only"` (never promoted to "standing") and
// a PR body that says, in words, "verify releasedAt/sourceUrl by hand
// before merging" — it proposes a citable STARTING point (a real,
// non-fabricated created_at) rather than guessing an announcement URL.
//
//   ANTHROPIC_API_KEY=sk-... node scripts/release-watch.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MODELS_PATH = resolve(ROOT, "observatory", "models.json");
const API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

/** Anthropic dated-snapshot ids end in an 8-digit date (`-20260101`) — these are pinned builds, not the alias families `observatory/models.json` tracks (`claude-haiku-4-5`, not `claude-haiku-4-5-20251001`). Excluded from "new model" candidacy; only a NEW alias family is worth a human's attention. */
export function isDatedSnapshotId(modelId) {
  return /-\d{8}$/.test(modelId);
}

/** Pure diff: which live API model ids are alias-shaped AND not already known to models.json. Exported for clarity/manual verification; not wired to vitest (this repo's scripts/ convention — see scripts/pack-check.mjs, scripts/calibration-report.mjs — is CI running the real script, not a parallel unit-test harness, since the one thing worth testing here, the live fetch, cannot be tested offline anyway). */
export function findNewModelCandidates(apiModels, knownModelIds) {
  const known = new Set(knownModelIds);
  return apiModels.filter((m) => !isDatedSnapshotId(m.id) && !known.has(m.id));
}

async function fetchAllModels(apiKey) {
  const headers = { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION };
  const out = [];
  let afterId;
  for (;;) {
    const url = new URL("/v1/models", API_BASE);
    url.searchParams.set("limit", "100");
    if (afterId !== undefined) url.searchParams.set("after_id", afterId);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GET /v1/models failed: HTTP ${String(res.status)}`);
    }
    const body = await res.json();
    for (const m of body.data ?? []) out.push(m);
    if (body.has_more !== true || body.last_id === undefined) break;
    afterId = body.last_id;
  }
  return out;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    console.log("release-watch: ANTHROPIC_API_KEY not set — skipping (degrades cleanly, SPEC §8 M7).");
    process.exit(0);
  }

  const manifest = JSON.parse(readFileSync(MODELS_PATH, "utf8"));
  const knownModelIds = manifest.models.map((m) => m.modelId);

  let apiModels;
  try {
    apiModels = await fetchAllModels(apiKey);
  } catch (error) {
    console.log(`release-watch: could not reach the Models API (${String(error)}) — skipping this run, not failing red.`);
    process.exit(0);
  }

  const candidates = findNewModelCandidates(apiModels, knownModelIds);
  if (candidates.length === 0) {
    console.log(`release-watch: no new model families — models.json already knows all ${String(apiModels.length)} listed ids (after excluding dated snapshots).`);
    process.exit(0);
  }

  for (const candidate of candidates) {
    manifest.models.push({
      modelId: candidate.id,
      displayName: candidate.display_name ?? candidate.id,
      // TODO(human review, required before merge): `created_at` is the
      // Models API's REGISTRATION date — verify against the actual public
      // announcement and replace with that date + a specific citable URL.
      releasedAt: (candidate.created_at ?? new Date().toISOString()).slice(0, 10),
      sourceUrl: "https://docs.claude.com/en/docs/about-claude/models — TODO: replace with the specific announcement URL",
      status: "release-only",
    });
  }
  manifest.models.sort((a, b) => a.modelId.localeCompare(b.modelId));

  writeFileSync(MODELS_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `release-watch: added ${String(candidates.length)} candidate model(s) to observatory/models.json: ` +
      candidates.map((c) => c.id).join(", "),
  );
  // release-watch.yml's create-pull-request step picks up this diff and
  // opens the PR — that PR is the human gate SPEC §8 describes, and merging
  // it does NOT add anything to observatory/panel.json (a separate step).
  process.exit(0);
}

await main();
