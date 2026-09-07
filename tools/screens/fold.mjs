// Viewport-only captures (the fold) plus zoomed crops, so type and depth can
// actually be judged rather than guessed at from a squeezed full-page thumb.
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const OUT = join(ROOT, "apps", "web", "out");
const TAG = process.env.SHOT_TAG ?? "fold";
if (!existsSync(join(OUT, "index.html"))) throw new Error(`no build at ${OUT}`);
if (!existsSync(join(OUT, "index.html"))) throw new Error(`no build at ${OUT} — run pnpm build first`);
const DEST = join(ROOT, "docs", "screens");
mkdirSync(DEST, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webm": "video/webm",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};
function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  for (const c of [join(OUT, clean), join(OUT, clean, "index.html"), join(OUT, `${clean}.html`), join(OUT, `${clean.replace(/\/$/, "")}.html`)]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}
const server = createServer((req, res) => {
  const file = resolveFile(req.url ?? "/");
  if (file === null) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(Number(process.env.SHOT_PORT ?? 0), "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();

// The fold, at both viewports.
for (const [name, w, h] of [["1440x900", 1440, 900], ["390x844", 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(DEST, `${TAG}-fold-${name}.png`) });
  await ctx.close();
}

// Zoomed crops at 2x device scale so type rendering is judgeable.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
for (const [name, sel] of [
  ["gates", '[data-testid="calibration-numbers"]'],
  ["chain", '[data-testid="watch-chain"]'],
  ["suites", '[data-testid="suite-house-skill-activation"]'],
]) {
  const el = page.locator(sel).first();
  if ((await el.count()) > 0) {
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await el.screenshot({ path: join(DEST, `${TAG}-crop-${name}.png`) });
    console.log(`crop ${name} ok`);
  } else {
    console.log(`crop ${name} MISSING`);
  }
}
await ctx.close();
await browser.close();
server.close();
