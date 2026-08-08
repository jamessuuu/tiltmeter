/**
 * The workflow/secret-boundary assertion (SPEC §9's fork-PR row, security-
 * critical; SECURITY.md "Fork PR / external-contributor secret boundary"):
 * "No workflow reachable by external input ever sees `ANTHROPIC_API_KEY`."
 * M7 makes this a CHECKED property, not just a reviewed one — `ci.yml`
 * runs `lintWorkflowSecretsInDir(".github/workflows")` on every push/PR and
 * fails red on any violation (`scripts/lint-workflow-secrets.mjs`).
 *
 * Mechanism: for each workflow file, resolve the file's own `on:` trigger
 * list; if none of those triggers are externally-triggerable (a fork PR
 * author, an issue commenter — anyone without repo write access), the
 * whole file is exempt regardless of what it references. Otherwise, walk
 * each `jobs.<id>` subtree looking for a `${{ secrets.X }}` reference
 * (anywhere in that job's own YAML, not just `env:` — a `run:` step can
 * reference a secret directly too); a job that references one is a
 * violation UNLESS its own `if:` narrows it to `workflow_dispatch` only
 * (the one manual, collaborator-gated trigger — SEE `ci.yml`'s own
 * `live-smoke` job, which mixes a PR-triggered job with a
 * workflow_dispatch-gated one in the same file and must NOT false-positive
 * here). This is deliberately narrow and pattern-based rather than a full
 * GitHub Actions expression evaluator — a job whose `if:` this module
 * cannot confidently read as workflow_dispatch-only is treated as
 * reachable (fail toward reporting a violation, never toward silence).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

/**
 * GitHub Actions events that fire (at least partly) under the control of
 * someone who is NOT a repo maintainer with write access — a fork PR
 * author, an issue/discussion commenter, etc. SPEC §9 names
 * `pull_request`/`pull_request_target`/`issue_comment` explicitly; the
 * rest are the same class of risk (any external actor can cause the event).
 */
export const EXTERNALLY_TRIGGERABLE_EVENTS = [
  "pull_request",
  "pull_request_target",
  "issue_comment",
  "issues",
  "discussion",
  "discussion_comment",
  "fork",
  "watch",
] as const;

const SECRET_REF_PATTERN = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;
const WORKFLOW_DISPATCH_ONLY_IF = /github\.event_name\s*==\s*['"]workflow_dispatch['"]/;

export interface WorkflowSecretViolation {
  file: string;
  job: string;
  secretRef: string;
  /** The externally-triggerable events present on this file's `on:` — why the job is reachable at all. */
  triggerEvents: string[];
}

/** GitHub Actions' `on:` accepts a bare string, an array, or a map (values possibly `null`) — normalize all three to a flat event-name list. */
export function triggerEventNames(onValue: unknown): string[] {
  if (typeof onValue === "string") return [onValue];
  if (Array.isArray(onValue)) return onValue.filter((v): v is string => typeof v === "string");
  if (onValue !== null && typeof onValue === "object") return Object.keys(onValue);
  return [];
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  }
}

/** Every distinct secret name referenced anywhere within a parsed YAML subtree (job, step, whole doc — whatever is passed). */
export function secretsReferencedIn(value: unknown): string[] {
  const strings: string[] = [];
  collectStrings(value, strings);
  const names = new Set<string>();
  for (const s of strings) {
    for (const m of s.matchAll(SECRET_REF_PATTERN)) {
      const name = m[1];
      if (name !== undefined) names.add(name);
    }
  }
  return [...names];
}

/** True only when the job's own `if:` contains the literal, narrow pattern `github.event_name == 'workflow_dispatch'` — a manual trigger only a repo collaborator with Actions access can fire. Anything else (no `if:`, a broader `if:`, an unrecognized expression) is NOT treated as narrowed — fail toward flagging. */
function isWorkflowDispatchOnlyGuarded(job: Record<string, unknown>): boolean {
  const ifValue = job.if;
  return typeof ifValue === "string" && WORKFLOW_DISPATCH_ONLY_IF.test(ifValue);
}

/**
 * Find every secret-boundary violation in ONE workflow file's already-read
 * text. Pure — takes text in, returns findings, never touches `fs` (the
 * directory walk is `lintWorkflowSecretsInDir` below). Malformed YAML
 * parses to `undefined`/non-object and is reported as zero violations here
 * — a workflow that doesn't even parse is a CI failure somewhere else
 * (this check is additive, not a YAML validator).
 */
export function findWorkflowSecretViolations(fileName: string, yamlText: string): WorkflowSecretViolation[] {
  let doc: unknown;
  try {
    doc = load(yamlText);
  } catch {
    return [];
  }
  if (doc === null || typeof doc !== "object") return [];
  const record = doc as Record<string, unknown>;

  const triggerEvents = triggerEventNames(record.on).filter((e) =>
    (EXTERNALLY_TRIGGERABLE_EVENTS as readonly string[]).includes(e),
  );
  if (triggerEvents.length === 0) return []; // the whole file is unreachable by external input

  const jobsValue = record.jobs;
  if (jobsValue === null || typeof jobsValue !== "object") return [];
  const jobs = jobsValue as Record<string, unknown>;

  const violations: WorkflowSecretViolation[] = [];
  for (const [jobId, jobValue] of Object.entries(jobs)) {
    if (jobValue === null || typeof jobValue !== "object") continue;
    const job = jobValue as Record<string, unknown>;
    const secretRefs = secretsReferencedIn(job);
    if (secretRefs.length === 0) continue;
    if (isWorkflowDispatchOnlyGuarded(job)) continue;
    for (const secretRef of secretRefs) {
      violations.push({ file: fileName, job: jobId, secretRef, triggerEvents });
    }
  }
  return violations;
}

/** Every `.yml`/`.yaml` file directly under `workflowsDir` (no recursion — GitHub Actions never nests workflow files), sorted for deterministic output. `[]` if the directory does not exist. */
export function lintWorkflowSecretsInDir(workflowsDir: string): WorkflowSecretViolation[] {
  if (!existsSync(workflowsDir)) return [];
  const files = readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();
  const violations: WorkflowSecretViolation[] = [];
  for (const file of files) {
    const text = readFileSync(join(workflowsDir, file), "utf8");
    violations.push(...findWorkflowSecretViolations(file, text));
  }
  return violations;
}
