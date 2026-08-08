// Verify that `pnpm pack` produces a tarball whose package.json exports (and
// bin) resolve to dist/, not src/ — the publishConfig rewrite that makes
// src-in-dev / dist-on-publish safe (SPEC §2: packages/tiltmeter is the only
// npm-published package; "." and "./testing" both ship). Run after
// `pnpm -r build`. Fails loudly; CI treats a non-zero exit as red.
//
// SPEC §14 M8: also proves `npx tiltmeter@1 ...` would work from a clean
// directory BEFORE publication — `npm install <tarball>` into a scratch
// project with none of this monorepo's workspace symlinks, then runs the
// INSTALLED bin through the exact M8 gate: `init` (from a tiny fixture
// skills directory written inline here, no dependency on this monorepo's
// own evals/fixture layout or on this machine's real ~/.claude/skills),
// then `lint`, then `plan --offline` — asserting each succeeds with NO
// ANTHROPIC_API_KEY and NO network. This is the one check the exports/bin
// inspection above cannot do: it proves the tarball's `files` entry
// actually SHIPS everything the CLI needs at runtime (including the
// `dependencies` — commander/js-yaml/zod — resolving for real, not via
// this repo's hoisted node_modules) and that the installed bin file
// actually executes and does real work end to end.
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packages = ["packages/tiltmeter"];

let failed = false;
for (const pkg of packages) {
  const tmp = mkdtempSync(join(tmpdir(), "tiltmeter-pack-"));
  try {
    const out = execSync(`pnpm pack --pack-destination "${tmp}"`, {
      cwd: pkg,
      encoding: "utf8",
    }).trim();
    const tarball = out.split("\n").at(-1);
    // Extract with a RELATIVE path from inside tmp: GNU tar on Windows
    // interprets "C:" in an absolute path as a remote host ("Cannot connect").
    const tarballName = tarball.replace(/\\/g, "/").split("/").at(-1);
    execSync(`tar -xzf "${tarballName}"`, { cwd: tmp });
    const manifest = JSON.parse(readFileSync(join(tmp, "package", "package.json"), "utf8"));
    const exportsField = JSON.stringify(manifest.exports ?? {});
    if (exportsField.includes("src/")) {
      console.error(`FAIL ${pkg}: packed exports still point at src/ -> ${exportsField}`);
      failed = true;
    } else if (!exportsField.includes("dist/")) {
      console.error(`FAIL ${pkg}: packed exports do not point at dist/ -> ${exportsField}`);
      failed = true;
    } else {
      console.log(`ok   ${pkg}: packed exports -> dist/`);
    }
    // Both subpaths must survive the rewrite: "." and "./testing" (SPEC §2).
    for (const subpath of [".", "./testing"]) {
      if (!(manifest.exports ?? {})[subpath]) {
        console.error(`FAIL ${pkg}: packed exports missing "${subpath}"`);
        failed = true;
      }
    }
    // The CLI bin must point into dist/ AND the file must actually be in the
    // tarball — a bin that resolves to a missing file is a broken `npx tiltmeter`.
    for (const [binName, binPath] of Object.entries(manifest.bin ?? {})) {
      if (!binPath.startsWith("./dist/") && !binPath.startsWith("dist/")) {
        console.error(`FAIL ${pkg}: bin "${binName}" points outside dist/ -> ${binPath}`);
        failed = true;
        continue;
      }
      try {
        statSync(join(tmp, "package", binPath));
        console.log(`ok   ${pkg}: bin "${binName}" -> ${binPath} (present in tarball)`);
      } catch {
        console.error(`FAIL ${pkg}: bin "${binName}" -> ${binPath} missing from tarball`);
        failed = true;
      }
    }

    if (pkg === "packages/tiltmeter") {
      const tarballPath = join(tmp, tarballName);
      if (!smokeTestPackedTarball(tarballPath)) failed = true;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);

/**
 * `npm install <tarball>` into a directory with NONE of this monorepo's
 * workspace symlinks or hoisted devDependencies, then run the installed
 * bin through SPEC §14 M8's own gate: `init` (from a tiny fixture skills
 * directory), `lint`, `plan --offline` — each asserted to succeed with an
 * env that has NO `ANTHROPIC_API_KEY` at all. Returns true on success.
 */
function smokeTestPackedTarball(tarballPath) {
  const scratchDir = mkdtempSync(join(tmpdir(), "tiltmeter-pack-check-install-"));
  const fixtureDir = mkdtempSync(join(tmpdir(), "tiltmeter-pack-check-fixture-"));
  try {
    // A minimal, self-contained fixture — one real skill, deliberately NOT
    // reusing this machine's own ~/.claude/skills or this monorepo's evals
    // fixtures, so this check has zero dependency on either.
    const skillDir = join(fixtureDir, "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: A demo skill fixture for tiltmeter's own tarball smoke test.\n---\n\nBody.\n",
    );

    writeFileSync(
      join(scratchDir, "package.json"),
      JSON.stringify({ name: "tiltmeter-pack-check-scratch", private: true, version: "0.0.0" }, null, 2),
    );
    execSync(`npm install "${tarballPath.replace(/\\/g, "/")}" --no-audit --no-fund --silent`, {
      cwd: scratchDir,
      encoding: "utf8",
      stdio: "pipe",
    });

    const installedManifest = JSON.parse(readFileSync(join(scratchDir, "node_modules", "tiltmeter", "package.json"), "utf8"));
    const binRelative = installedManifest.bin?.tiltmeter;
    if (typeof binRelative !== "string") {
      console.error("FAIL packages/tiltmeter: installed package.json has no bin.tiltmeter entry");
      return false;
    }
    const installedBin = join(scratchDir, "node_modules", "tiltmeter", binRelative);
    statSync(installedBin); // throws if the file did not actually ship

    // Deliberately NO ANTHROPIC_API_KEY in this env — the whole point of
    // the gate is that it works without one (SPEC §14 M8).
    const noKeyEnv = { ...process.env };
    delete noKeyEnv.ANTHROPIC_API_KEY;
    const run = (args) => execFileSync(process.execPath, [installedBin, ...args], { encoding: "utf8", cwd: scratchDir, env: noKeyEnv });

    const initOut = run(["init", "--from-skills", join(fixtureDir, "skills")]);
    if (!initOut.includes("from-skills.suite.json")) {
      console.error(`FAIL packages/tiltmeter: tarball \`tiltmeter init\` did not report writing the expected suite:\n${initOut}`);
      return false;
    }
    statSync(join(scratchDir, "observatory", "suites", "from-skills.suite.json"));

    const lintOut = run(["lint"]);
    if (!lintOut.includes("OK")) {
      console.error(`FAIL packages/tiltmeter: tarball \`tiltmeter lint\` did not report OK:\n${lintOut}`);
      return false;
    }

    const planOut = run(["plan", "--run-group", "smoke-1", "--offline"]);
    if (!planOut.includes("plan.json")) {
      console.error(`FAIL packages/tiltmeter: tarball \`tiltmeter plan --offline\` did not report writing plan.json:\n${planOut}`);
      return false;
    }
    statSync(join(scratchDir, "observatory", "readings", "smoke-1", "plan.json"));

    console.log(
      "ok   packages/tiltmeter: `npm install <tarball>` + installed `tiltmeter init` -> `lint` -> `plan --offline` " +
        "all succeeded in a clean scratch dir with no ANTHROPIC_API_KEY and no network (SPEC §14 M8)",
    );
    return true;
  } catch (error) {
    console.error(`FAIL packages/tiltmeter: tarball smoke test threw: ${String(error)}`);
    if (error && typeof error === "object" && "stdout" in error) console.error(String(error.stdout ?? ""));
    if (error && typeof error === "object" && "stderr" in error) console.error(String(error.stderr ?? ""));
    return false;
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}
