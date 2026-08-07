// Verify that `pnpm pack` produces a tarball whose package.json exports (and
// bin) resolve to dist/, not src/ — the publishConfig rewrite that makes
// src-in-dev / dist-on-publish safe (SPEC §2: packages/tiltmeter is the only
// npm-published package; "." and "./testing" both ship). Run after
// `pnpm -r build`. Fails loudly; CI treats a non-zero exit as red.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
