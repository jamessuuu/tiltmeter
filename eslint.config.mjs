// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// SPEC §6 boundary: src/core (and src/testing, which consumers import in
// their own test suites) is pure and isomorphic — zero I/O, no env, no
// sockets. Node builtins live in src/node/** and src/cli/** only; the
// network lives in src/client/** only.
const NODE_BUILTINS = [
  "node:*",
  "fs",
  "path",
  "os",
  "crypto",
  "child_process",
  "url",
  "util",
  "stream",
  "events",
  "buffer",
  "http",
  "https",
  "net",
  "tls",
  "worker_threads",
];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs", "scripts/*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Boundary discipline (SPEC §13 / feasibility §4.2): no `as any` sneaking through.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // SPEC §6: core never imports node builtins, never opens a socket, never
    // reads env — it runs identically in the CLI, in CI, and in a browser.
    // src/client is the ONLY network boundary, so `fetch` is banned here too.
    // Determinism is a hard rule (§5): no Math.random, no ambient clock —
    // the PRNG is seeded and in-repo, the clock is injected.
    // Tests are exempt (they run under vitest on node and may cross-check
    // against node:crypto); the published build excludes them.
    files: [
      "packages/tiltmeter/src/core/**/*.ts",
      "packages/tiltmeter/src/testing/**/*.ts",
    ],
    ignores: ["packages/tiltmeter/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: NODE_BUILTINS,
              message:
                "SPEC §6 boundary: tiltmeter core/testing is pure and isomorphic (zero I/O, no env). Move node-dependent code to src/node/** or src/cli/**, or inject the capability (client, clock) through options.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "SPEC §6: src/client is the ONLY network boundary. core never opens a socket — inject a ModelClient (FakeModelClient in tests).",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "globalThis",
          property: "fetch",
          message:
            "SPEC §6: src/client is the ONLY network boundary. core never opens a socket — inject a ModelClient (FakeModelClient in tests).",
        },
        {
          object: "Math",
          property: "random",
          message:
            "SPEC §5: deterministic everywhere. Use the seeded in-repo PRNG (core/prng) with a derived seed — never ambient randomness.",
        },
        {
          object: "Date",
          property: "now",
          message:
            "SPEC §6: core reads no ambient state. Inject the clock through options; tests pass a fixed clock.",
        },
      ],
    },
  },
  {
    // SHA-256 hot loop: typed-array indexing under noUncheckedIndexedAccess.
    // Bounds are structurally guaranteed (fixed-size Uint32Array, loop
    // bounds); per-access guards would be noise. The FIPS vectors + the
    // node:crypto cross-check in sha256.test.ts are the real safety net.
    files: ["packages/tiltmeter/src/core/sha256.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["**/*.mjs", "scripts/**"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
  }
);
