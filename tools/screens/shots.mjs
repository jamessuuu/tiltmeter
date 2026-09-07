// Screenshot harness. Serves apps/web/out on a port taken from an env var
// (never a fixed shared port — two projects today ran a whole suite against
// another project's site), then captures full-page PNGs at both viewports.
//
//   SHOT_PORT=4821 SHOT_TAG=before node scripts/_shots.mjs
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const OUT = join(ROOT, "apps", "web", "out");
const TAG = process.env.SHOT_TAG ?? "shot";
const PORT = Number(process.env.SHOT_PORT ?? 0);
if (!existsSync(join(OUT, "index.html"))) throw new Error(`no build at ${OUT} — run pnpm build first`);
const DEST = join(ROOT, "docs", "screens");
mkdirSync(DEST, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const candidates = [
    join(OUT, clean),
    join(OUT, clean, "index.html"),
    join(OUT, `${clean}.html`),
    join(OUT, `${clean.replace(/\/$/, "")}.html`),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const server = createServer((req, res) => {
  const file = resolveFile(req.url ?? "/");
  if (file === null) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

const ROUTES = [
  ["home", "/"],
  ["methodology", "/methodology/"],
  ["suite", "/suites/house-skill-activation/"],
  ["models", "/models/"],
  ["docs", "/docs/"],
  ["reading", "/readings/none-yet/"],
];
const VIEWPORTS = [
  ["1440x900", 1440, 900],
  ["390x844", 390, 844],
];

await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
console.log(`serving ${OUT} on ${base}`);

const browser = await chromium.launch();
const report = [];
for (const [vpName, width, height] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name, path] of ROUTES) {
    const resp = await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const file = join(DEST, `${TAG}-${name}-${vpName}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    // Real PNG pixel width from the IHDR chunk — scrollWidth lies when an
    // ambient gradient bleeds past the viewport.
    const buf = readFileSync(file);
    const pngW = buf.readUInt32BE(16);
    const pngH = buf.readUInt32BE(20);
    report.push({ vp: vpName, name, status: resp?.status(), ...metrics, pngW, pngH, file });
    console.log(
      `${vpName} ${name.padEnd(12)} http=${resp?.status()} scrollW=${metrics.scrollWidth} pngW=${pngW} pngH=${pngH}` +
        (pngW > width ? "  <<< OVERFLOW" : ""),
    );
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log("\nOVERFLOWS:", report.filter((r) => r.pngW > Number(r.vp.split("x")[0])).length);
