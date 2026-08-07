import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest 4: `passWithNoTests` is a root-only option (NonProjectOptions),
    // not settable per-project — it applies to every project's run. M0
    // scaffold: the golden/calibration eval suites land at M1/M3 (SPEC §12,
    // §14), so the "eval" project has no files yet. Once M1 lands its first
    // `evals/**/*.eval.test.ts` file, both projects always have matching
    // files and this reverts to strict (the default, `false`).
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "eval",
          include: ["evals/**/*.eval.test.ts"],
        },
      },
    ],
  },
});
