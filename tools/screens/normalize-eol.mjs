// Restore LF line endings on files a Windows Python text-mode write turned
// into CRLF. The calibration drift gate compares the README block
// byte-for-byte, so a line-ending flip fails it even though not one
// character of content changed — a genuinely confusing failure worth
// leaving a note about.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
for (const rel of process.argv.slice(2)) {
  const path = resolve(ROOT, rel);
  const before = readFileSync(path);
  const after = Buffer.from(before.toString("utf8").split("\r\n").join("\n"), "utf8");
  if (before.equals(after)) {
    console.log(`unchanged ${rel}`);
    continue;
  }
  writeFileSync(path, after);
  console.log(`normalized ${rel} (${String(before.length)} -> ${String(after.length)} bytes)`);
}
