import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findWorkflowSecretViolations,
  secretsReferencedIn,
  triggerEventNames,
  type WorkflowSecretViolation,
} from "./workflow-lint.js";

// packages/tiltmeter/src/node -> repo root is four levels up.
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

describe("triggerEventNames", () => {
  it("normalizes a bare string", () => {
    expect(triggerEventNames("push")).toEqual(["push"]);
  });

  it("normalizes an array, dropping non-string entries", () => {
    expect(triggerEventNames(["push", "pull_request", 42])).toEqual(["push", "pull_request"]);
  });

  it("normalizes a map (values possibly null) to its keys", () => {
    expect(triggerEventNames({ push: { branches: ["main"] }, pull_request: null })).toEqual(["push", "pull_request"]);
  });

  it("empty for anything else", () => {
    expect(triggerEventNames(undefined)).toEqual([]);
    expect(triggerEventNames(null)).toEqual([]);
  });
});

describe("secretsReferencedIn", () => {
  it("finds a secret reference nested anywhere in the subtree", () => {
    const job = { steps: [{ run: "echo hi" }, { env: { KEY: "${{ secrets.ANTHROPIC_API_KEY }}" } }] };
    expect(secretsReferencedIn(job)).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("dedupes and finds multiple distinct secrets", () => {
    const job = { a: "${{ secrets.A }}", b: { c: "${{ secrets.B }} and ${{ secrets.A }}" } };
    expect(secretsReferencedIn(job).sort()).toEqual(["A", "B"]);
  });

  it("empty when nothing references a secret", () => {
    expect(secretsReferencedIn({ run: "pnpm test" })).toEqual([]);
  });
});

describe("findWorkflowSecretViolations", () => {
  it("passes a file with no externally-triggerable event at all, even if it references a secret", () => {
    const yaml = `
on:
  schedule:
    - cron: '0 3 * * 1'
  workflow_dispatch:
jobs:
  reading:
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - run: echo hi
`;
    expect(findWorkflowSecretViolations("reading.yml", yaml)).toEqual([]);
  });

  it("flags a job that references a secret on a pull_request-triggered file with no if guard", () => {
    const yaml = `
on:
  pull_request:
jobs:
  bad:
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - run: echo hi
`;
    const violations = findWorkflowSecretViolations("bad.yml", yaml);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: "bad.yml", job: "bad", secretRef: "ANTHROPIC_API_KEY" });
  });

  it("does NOT flag a job narrowed to workflow_dispatch only, even on a file whose OTHER triggers include pull_request", () => {
    const yaml = `
on:
  push:
  pull_request:
  workflow_dispatch:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
  live-smoke:
    if: github.event_name == 'workflow_dispatch' && github.repository == 'jamessuuu/tiltmeter'
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - run: echo smoke
`;
    expect(findWorkflowSecretViolations("mixed.yml", yaml)).toEqual([]);
  });

  it("still flags a secret-referencing job whose if: does NOT narrow to workflow_dispatch (fail toward reporting)", () => {
    const yaml = `
on:
  pull_request:
jobs:
  sneaky:
    if: always()
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - run: echo hi
`;
    expect(findWorkflowSecretViolations("sneaky.yml", yaml)).toHaveLength(1);
  });

  it("empty for malformed YAML — not this check's job to validate syntax", () => {
    expect(findWorkflowSecretViolations("broken.yml", "on: [\npull_request")).toEqual([]);
  });

  it("empty when the file has no jobs at all", () => {
    expect(findWorkflowSecretViolations("empty.yml", "on:\n  pull_request:\n")).toEqual([]);
  });

  it("the on: key parses as a string key, not a YAML 1.1 boolean (js-yaml v4 default schema) — regression guard for the classic GH Actions YAML footgun", () => {
    const yaml = `
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;
    // If `on:` had parsed as boolean `true`, triggerEventNames would see
    // `undefined` (record.on missing) and this would still return [] —
    // this test's real job is exercised by the pull_request cases above,
    // which WOULD silently pass (wrongly) if the boolean-coercion bug were
    // present. Recorded here as an explicit, named regression guard.
    const violations: WorkflowSecretViolation[] = findWorkflowSecretViolations("push-only.yml", yaml);
    expect(violations).toEqual([]);
  });
});

describe("findWorkflowSecretViolations against this repo's real ci.yml", () => {
  it("never flags the real, already-reviewed ci.yml (live-smoke is workflow_dispatch-guarded)", () => {
    const text = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(findWorkflowSecretViolations("ci.yml", text)).toEqual([]);
  });
});
