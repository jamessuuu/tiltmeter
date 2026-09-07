/**
 * Verify the LIVE deployment renders the real data — in a real browser,
 * against the rendered DOM, never against raw HTML. React splits text into
 * separate nodes ("108", " items · ", "34"), so a substring grep of the
 * served HTML reports MISSING for text that is plainly on the page. That is
 * the same class of error project-gate.mjs was built to kill: a checker
 * examining the wrong slice of reality manufactures confidence, or in this
 * case manufactures alarm.
 */
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";

const URL = process.env.VERIFY_URL;
if (!URL) throw new Error("set VERIFY_URL");

const MUST_CONTAIN = [
  "0.0%",
  "95.0%",
  "190/200 caught",
  "0/200 fired",
  "rg-20260831-1",
  "$0.7984",
  "$0.9980",
  "+25.0%",
  "chain verified unbroken at build",
  "108 items",
  "10,000",
  "400 seeded trials",
  "ANTHROPIC_API_KEY not set",
  "There is no time series yet",
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const failed = [];
page.on("response", (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
});
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const text = await page.locator("body").innerText();
let bad = 0;
for (const needle of MUST_CONTAIN) {
  const ok = text.includes(needle);
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${needle}`);
}

const fonts = await page.evaluate(() =>
  [...new Set([...document.querySelectorAll("*")].map((e) => getComputedStyle(e).fontFamily.split(",")[0].replace(/"/g, "")))].filter(Boolean),
);
const loaded = await page.evaluate(() => document.fonts.check('16px "Commit Mono"') && document.fonts.check('16px Archivo'));
console.log(`\nfont families in use: ${fonts.join(" | ")}`);
console.log(`Archivo + Commit Mono actually loaded: ${String(loaded)}`);
console.log(`failed requests: ${failed.length === 0 ? "none" : failed.join(", ")}`);
console.log(`\n${String(MUST_CONTAIN.length - bad)}/${String(MUST_CONTAIN.length)} strings present`);

await browser.close();
if (bad > 0 || failed.length > 0) process.exitCode = 1;
