/**
 * Raises every muted ink step to one that actually clears WCAG 1.4.3.
 *
 * Measured minimum alpha for 4.5:1 over each ground this site uses:
 *   paper  #faf7f2 -> /60      sub-1 #fffdfa -> /59      sunk #efe8dd -> /62
 * so /65 is the first step that clears everywhere with margin (5.43:1 over
 * paper). Everything below it fails somewhere.
 *
 * The mapping preserves the hierarchy instead of flattening it — the most
 * muted tier lands exactly on the floor and the less muted tiers stay
 * above it, so "de-emphasised" still reads as de-emphasised, it just also
 * reads. Steps at /65 and above are already compliant and are left alone.
 *
 *   /35 /40 /45  ->  /65   the muted tier: hashes, eyebrows, timestamps
 *   /50 /55      ->  /70   labels and column headers
 *   /60          ->  /75   secondary body
 *
 * `decoration-ink/NN` is deliberately NOT touched: a strikethrough rule is
 * decoration, and 1.4.3 governs text. The struck PRICE itself is text and
 * is covered by the /40 -> /65 step above.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { readdirSync, statSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "..", "..", "apps", "web");
const MAP = { 35: 65, 40: 65, 45: 65, 50: 70, 55: 70, 60: 75 };

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "out") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

let changed = 0;
let edits = 0;
for (const file of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))]) {
  const src = readFileSync(file, "utf8");
  let out = src;
  for (const [from, to] of Object.entries(MAP)) {
    // `text-ink/NN` only — never decoration-ink, border-ink or bg-ink.
    const pattern = new RegExp(`text-ink/${from}\\b`, "g");
    const hits = out.match(pattern);
    if (hits) {
      edits += hits.length;
      out = out.replace(pattern, `text-ink/${to}`);
    }
  }
  if (out !== src) {
    writeFileSync(file, out);
    changed++;
    console.log(`  ${file.replace(ROOT, "apps/web")}`);
  }
}
console.log(`\n${String(edits)} class replacements across ${String(changed)} files`);
