import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // M1 landed evals/golden.eval.test.ts, so both projects always have
    // matching files now — back to strict (the default, `false`: an empty
    // project run is a red CI, not a silent pass). See CHANGELOG.md M0 for
    // why this was `true` before M1 (vitest 4 made `passWithNoTests` a
    // root-only option, not settable per-project).
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "packages/*/src/**/*.test.ts",
            "packages/*/test/**/*.test.ts",
            // apps/web's pure lib/ functions (SPEC §14 M6: "the dead-man
            // banner unit-tested at the 10-day boundary") — component/page
            // rendering itself is Playwright's job (apps/web/e2e/**), not
            // Vitest's; this only covers logic isolated from React/Next.
            "apps/web/lib/**/*.test.ts",
          ],
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
