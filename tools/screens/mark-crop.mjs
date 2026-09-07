// Crops the two replaced marks so the SVG can be compared to the glyph it
// replaced by eye, rather than assumed to look the same.
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const BASE = process.env.CROP_BASE;
if (!BASE) throw new Error("set CROP_BASE");
const DEST = resolve(import.meta.dirname, "..", "..", "docs", "screens");
mkdirSync(DEST, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

// The disclosure caret, closed then open, to prove the rotation still works.
const summary = page.locator("summary").first();
await summary.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await summary.screenshot({ path: join(DEST, "mark-caret-closed.png") });
await summary.click();
await page.waitForTimeout(600);
await summary.screenshot({ path: join(DEST, "mark-caret-open.png") });
console.log("caret closed + open captured");

// The chain arrow, in context between the two prices.
const shift = page.locator('[data-testid="watch-chain"] .panel-hover').first();
if ((await shift.count()) > 0) {
  await shift.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shift.screenshot({ path: join(DEST, "mark-arrow-context.png") });
  console.log("chain arrow captured");
}

await browser.close();
