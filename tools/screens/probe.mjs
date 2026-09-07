// Diagnostic probe: names the exact nodes failing the gate's a11y floor and
// the exact URLs 404ing, so fixes are aimed rather than guessed.
import { chromium } from "file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs";

const base = process.env.PROBE_URL;
if (!base) throw new Error("set PROBE_URL");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const bad = [];
page.on("response", (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
});
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const info = await page.evaluate(() => {
  const targets = [...document.querySelectorAll("button,[role=button],a[href]")].filter(
    (c) => c.getBoundingClientRect().width > 0,
  );
  const sized = targets.filter(
    (c) => !(c.tagName === "A" && /^(P|LI|SPAN|TD|H[1-6])$/.test(c.parentElement?.tagName || "")),
  );
  const below = sized
    .filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width < 24 || r.height < 24;
    })
    .map((c) => {
      const r = c.getBoundingClientRect();
      return `${c.tagName}.${c.className || "-"} parent=${c.parentElement?.tagName} "${(c.textContent || "").trim().slice(0, 28)}" ${Math.round(r.width)}x${Math.round(r.height)}`;
    });
  const imgs = [...document.querySelectorAll("img")].map(
    (i) => `${i.getAttribute("src")} alt=${JSON.stringify(i.getAttribute("alt"))}`,
  );
  const fonts = [...new Set([...document.querySelectorAll("*")].map((e) => getComputedStyle(e).fontFamily.split(",")[0].replace(/"/g, "")))];
  const shadowed = [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).boxShadow !== "none").length;
  const transitions = [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).transitionDuration !== "0s").length;
  const radii = [...new Set([...document.querySelectorAll("*")].map((e) => getComputedStyle(e).borderRadius).filter((r) => r && r !== "0px"))];
  const maxType = Math.max(...[...document.querySelectorAll("*")].map((e) => parseFloat(getComputedStyle(e).fontSize) || 0));
  return { below, imgs, fonts, shadowed, transitions, radii, maxType, words: (document.body.innerText.match(/\S+/g) || []).length };
});

console.log("--- under 24px ---");
for (const b of info.below) console.log("  " + b);
console.log("--- images ---");
for (const i of info.imgs) console.log("  " + i);
console.log("--- 4xx/5xx ---");
for (const b of bad) console.log("  " + b);
console.log("--- profile ---");
console.log(`  font families: ${info.fonts.join(" | ")}`);
console.log(`  box-shadowed nodes: ${info.shadowed}`);
console.log(`  transitions: ${info.transitions}`);
console.log(`  radii: ${info.radii.join(" ")}`);
console.log(`  largest type: ${info.maxType}px`);
console.log(`  words: ${info.words}`);

await browser.close();
