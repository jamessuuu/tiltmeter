/**
 * Mechanism diagram generator — the ONE diagram this project gets
 * (DESIGN-DIRECTION.md: "each project has exactly one idea that a diagram
 * explains faster than prose. Draw that one, and only that one."). For
 * tiltmeter that idea is the axis tuple (SPEC §4): a comparison is computed
 * only when EXACTLY ONE of five axis elements differs between two readings;
 * anything else is `cannot-attribute`, never guessed.
 *
 * Same house line language as scripts/brand.mjs: the docs/DESIGN.md
 * palette, ink strokes, 0-2px radius, no gradients, no drop shadows, no
 * rounded "friendly" corners. Deterministic by construction — no
 * Math.random, no webfont, no network, no date stamping — so CI can
 * regenerate and fail on drift exactly like brand-drift/calibration-drift.
 *
 * Usage:  node scripts/diagram.mjs --out=apps/web/public/diagram
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// docs/DESIGN.md palette — same constants as brand.mjs. Do not invent colours.
const PAPER = "#FAF7F2";
const INK = "#1A1712";
const AMBER = "#B45309";
const RULE = "#E4DDD3";

const SW = 2; // standard ink stroke
const SWH = 1; // hairline

// SPEC §4 / packages/tiltmeter/src/core/reading.ts AXIS_TUPLE_KEYS, in
// canonical order. Short labels are what fits a 64px-ish column at
// diagram scale; the full field name is carried in each swatch's <title>.
const AXES = [
  { key: "suiteSpecHash", label: "suite" },
  { key: "modelIdResolved", label: "model" },
  { key: "runnerBehaviorVersion", label: "runner" },
  { key: "presentationHash", label: "present" },
  { key: "samplingPolicyHash", label: "sampling" },
];

const COL_W = 64;
const COL_GAP = 18;
const GRID_X0 = 92;
const SWATCH_H = 30;

function colX(i) {
  return GRID_X0 + i * (COL_W + COL_GAP);
}

const GRID_W = AXES.length * COL_W + (AXES.length - 1) * COL_GAP;

/** One axis swatch: outline-only ("same"), or filled ink ("differs"). */
function swatch(x, y, differs) {
  return differs
    ? `<rect x="${x}" y="${y}" width="${COL_W}" height="${SWATCH_H}" fill="${INK}"/>`
    : `<rect x="${x}" y="${y}" width="${COL_W}" height="${SWATCH_H}" fill="none" stroke="${INK}" stroke-width="${SW}"/>`;
}

function text(x, y, s, { size = 12, anchor = "start", weight = "400", fill = INK, family = "mono" } = {}) {
  const ff =
    family === "mono"
      ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      : "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  return `<text x="${x}" y="${y}" font-family="${ff}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(s)}</text>`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Ink arrow: a straight shaft plus a solid triangular head. Amber only when `amber` is set. */
function arrow(x0, y, x1, { amber = false } = {}) {
  const color = amber ? AMBER : INK;
  const w = amber ? SW + 1 : SW;
  const headLen = 12;
  const headW = 9;
  const shaftEnd = x1 - headLen;
  const head = `<path d="M${shaftEnd} ${y - headW / 2} L${x1} ${y} L${shaftEnd} ${y + headW / 2} Z" fill="${color}"/>`;
  const shaft = `<path d="M${x0} ${y} H${shaftEnd}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
  return shaft + head;
}

/** Greedy word-wrap into at most `maxLines` lines of roughly `maxChars` characters. */
function wrap(s, maxChars, maxLines = 2) {
  const words = s.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

function verdictBox(x, y, w, h, label, sub, { amber = false } = {}) {
  const stroke = amber ? AMBER : INK;
  const rect = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="${SW}"/>`;
  const subLines = sub ? wrap(sub, 30) : [];
  const labelY = subLines.length ? y + h / 2 - 6 : y + h / 2 + 5;
  const t1 = text(x + w / 2, labelY, label, {
    size: 14,
    weight: "600",
    anchor: "middle",
    family: "mono",
    fill: stroke,
  });
  const t2 = subLines
    .map((line, i) =>
      text(x + w / 2, y + h / 2 + 14 + i * 13, line, { size: 9.5, anchor: "middle", family: "sans", fill: INK }),
    )
    .join("");
  return rect + t1 + t2;
}

/**
 * One comparison block: two axis strips (reading A over reading B) with
 * `diffIndices` filled to mark which axis element(s) changed, an arrow to
 * a verdict box, axis-name labels under the strip, and a one-line caption.
 * Returns both the markup and the y-coordinate of its lowest element, so
 * the caller can stack blocks without hand-tuned vertical offsets.
 */
function block(y0, { diffIndices, verdict, sub, amberArrow, caption }) {
  const rowATop = y0;
  const rowBTop = y0 + SWATCH_H + 6;
  const out = [];
  AXES.forEach((axis, i) => {
    const x = colX(i);
    out.push(swatch(x, rowATop, false)); // reading A: never the "changed" side, by convention
    out.push(swatch(x, rowBTop, diffIndices.includes(i)));
  });
  // reading A / reading B row labels, left of the grid
  out.push(text(GRID_X0 - 14, rowATop + SWATCH_H / 2 + 4, "A", { size: 12, anchor: "end", weight: "600" }));
  out.push(text(GRID_X0 - 14, rowBTop + SWATCH_H / 2 + 4, "B", { size: 12, anchor: "end", weight: "600" }));

  const gridRight = colX(AXES.length - 1) + COL_W;
  const arrowY = rowATop + SWATCH_H + 3;
  const boxX = gridRight + 56;
  const boxW = 210;
  const boxH = 68;
  out.push(arrow(gridRight + 14, arrowY, boxX, { amber: amberArrow }));
  out.push(verdictBox(boxX, arrowY - boxH / 2, boxW, boxH, verdict, sub, { amber: amberArrow }));

  const axisLabelY = rowBTop + SWATCH_H + 16;
  out.push(
    AXES.map((axis, i) => text(colX(i) + COL_W / 2, axisLabelY, axis.label, { size: 10, anchor: "middle", family: "mono" })).join(""),
  );

  const captionY = axisLabelY + 20;
  out.push(
    text(GRID_X0, captionY, caption, {
      size: 11,
      family: "sans",
      fill: amberArrow ? AMBER : "#5a5347",
    }),
  );

  return { svg: out.join(""), bottom: captionY };
}

function buildSvg() {
  const W = 900;
  const row1Y = 34;

  const title = "tiltmeter's axis tuple: one difference is a verdict, two is a refusal";
  const desc =
    "Two stacked comparisons of the same five-element axis tuple (suite, model, runner, presentation, sampling). " +
    "Top: reading A and reading B differ on exactly one axis, model — the comparison resolves to a verdict " +
    "(regressed, improved, or moved-within-noise). Bottom: reading A and reading B differ on two axes, suite and " +
    "model at once — the comparison refuses to resolve and is published as cannot-attribute, drawn in amber because " +
    "refusing to answer is the argument this project makes.";

  // top comparison: exactly one axis differs (model) -> a verdict
  const block1 = block(row1Y, {
    diffIndices: [1],
    verdict: "verdict",
    sub: "regressed / improved / moved-within-noise",
    amberArrow: false,
    caption: "one axis differs (model) → attributable",
  });

  const dividerY = block1.bottom + 20;

  // bottom comparison: two axes differ (suite + model) -> cannot-attribute, THE one amber element
  const row2Y = dividerY + 26;
  const block2 = block(row2Y, {
    diffIndices: [0, 1],
    verdict: "cannot-attribute",
    sub: "reasons: suiteSpecHash + modelIdResolved",
    amberArrow: true,
    caption: "two axes differ (suite + model) → refused, not guessed",
  });

  const H = block2.bottom + 24;

  const body = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="dtitle ddesc">`,
    `<title id="dtitle">${escapeXml(title)}</title>`,
    `<desc id="ddesc">${escapeXml(desc)}</desc>`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
    block1.svg,
    `<path d="M${GRID_X0} ${dividerY} H${GRID_X0 + GRID_W + 322}" stroke="${RULE}" stroke-width="${SWH}" stroke-dasharray="3 3"/>`,
    block2.svg,
    `</svg>\n`,
  ];

  return body.join("");
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    }),
  );
  const outDir = args.out ?? "apps/web/public/diagram";
  mkdirSync(outDir, { recursive: true });
  const svg = buildSvg();
  const path = join(outDir, "attribution.svg");
  writeFileSync(path, svg);
  console.log(`diagram: attribution -> ${path}`);
}

main();
