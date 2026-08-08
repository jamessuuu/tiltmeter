// SPEC §9 fork-PR/secret-boundary row, security-critical: "No workflow
// reachable by external input ever sees ANTHROPIC_API_KEY." CI enforcement
// (M7) for that property — a new `lint-workflows` stage in ci.yml runs this
// on every push/PR, so the property is CHECKED, not just reviewed.
//
// Requires `pnpm --filter tiltmeter build` first — imports the compiled
// dist (mirrors scripts/calibration-report.mjs's pattern). The real logic
// (`lintWorkflowSecretsInDir` / `findWorkflowSecretViolations`) lives in
// packages/tiltmeter/src/node/workflow-lint.ts with its own unit tests
// (packages/tiltmeter/src/node/workflow-lint.test.ts) — this file is CI
// wiring only.
//
//   node scripts/lint-workflow-secrets.mjs
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WORKFLOWS_DIR = resolve(ROOT, ".github", "workflows");

const { lintWorkflowSecretsInDir } = await import("../packages/tiltmeter/dist/node/workflow-lint.js");

const violations = lintWorkflowSecretsInDir(WORKFLOWS_DIR);

if (violations.length === 0) {
  console.log(
    "lint-workflow-secrets: OK — no workflow reachable by external input (" +
      "pull_request/pull_request_target/issue_comment/…) references a secret.",
  );
  process.exit(0);
}

console.error("lint-workflow-secrets: FAIL — a secret is reachable from external input:");
for (const v of violations) {
  console.error(
    `  ${v.file} job "${v.job}": references secrets.${v.secretRef}, reachable via [${v.triggerEvents.join(", ")}] ` +
      "with no workflow_dispatch-only guard",
  );
}
console.error(
  "\nFix: remove the secret reference from the job, or gate the job with " +
    "`if: github.event_name == 'workflow_dispatch'` (the one manual, collaborator-only trigger), " +
    "or drop the externally-triggerable event from the workflow's `on:` entirely.",
);
process.exit(1);
