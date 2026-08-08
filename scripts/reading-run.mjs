// SPEC §8 M7 `reading.yml` — the weekly scheduled reading. Wraps
// `runScheduledReading` from the compiled dist (mirrors
// scripts/calibration-report.mjs's "import the compiled dist" pattern).
// The real logic — the cap preflight that closes the one gap in `plan`'s
// own contract, then delegating to the already-tested `plan`/`run`
// commands — lives in packages/tiltmeter/src/cli/commands/scheduled-reading.ts
// with its own unit tests; this file is CI wiring only: real argv/env/fs,
// the real `AnthropicModelClient`, a real clock.
//
// Requires `pnpm --filter tiltmeter build` first.
//
//   node scripts/reading-run.mjs --run-group rg-20260817-1 [--mode batch|sync]
//
// Never run by this build (HARD RULE: no live API call, no key use in this
// session) — committed so reading.yml has something real to invoke.
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  let runGroupId;
  let mode = "batch";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-group") runGroupId = argv[++i];
    else if (argv[i] === "--mode") mode = argv[++i];
  }
  return { runGroupId, mode };
}

function defaultRunGroupId(now) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `rg-${date}-1`;
}

async function main() {
  const { runGroupId: argRunGroupId, mode } = parseArgs(process.argv.slice(2));
  if (mode !== "batch" && mode !== "sync") {
    console.error(`reading-run: --mode must be "batch" or "sync", got "${mode}"`);
    process.exit(1);
  }

  const { runScheduledReading } = await import("../packages/tiltmeter/dist/cli/commands/scheduled-reading.js");
  const { AnthropicModelClient } = await import("../packages/tiltmeter/dist/client/anthropic.js");

  const now = new Date();
  const runGroupId = argRunGroupId ?? defaultRunGroupId(now);

  const io = {
    stdout: (text) => {
      console.log(text);
    },
    stderr: (text) => {
      console.error(text);
    },
  };

  const code = await runScheduledReading(
    io,
    { runGroupId, mode },
    {
      cwd: ROOT,
      env: process.env,
      now: () => new Date().toISOString(),
      harnessCommit: process.env.GITHUB_SHA ?? "unknown",
      buildClient: (apiKey) => new AnthropicModelClient({ apiKey }),
    },
  );
  process.exit(code);
}

await main();
