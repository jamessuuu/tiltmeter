/**
 * Applies the gate-driven fixes found by tools/screens/probe.mjs:
 *
 *  - img alt: the header glyph and the reduced-motion demo poster both
 *    shipped `alt=""`. The poster one is a real defect — under
 *    prefers-reduced-motion that image REPLACES the video, so it carries
 *    the content and needs a description, not an empty alt.
 *  - tap targets: seven links rendered under 24px tall at 390px wide
 *    (WCAG 2.2 AA SC 2.5.8). Fixed with vertical padding / inline-block,
 *    not by shrinking the check.
 *  - prefetch 404s: `next/link` prefetches an RSC payload at a dotted
 *    path (`/models/__next.models.__PAGE__.txt`) while `output: "export"`
 *    writes it nested (`/models/__next.models/__PAGE__.txt`), so every
 *    prefetch 404s. The site is fully static — prefetch buys nothing —
 *    so it is turned off rather than papered over.
 *
 * In a file because backslash escapes do not survive the Bash tool's
 * quoting into `node -e`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const edits = [
  [
    "apps/web/components/Header.tsx",
    [
      [
        '<Image src="/brand/glyph.svg" alt="" aria-hidden="true" width={24} height={24} priority />',
        '<Image src="/brand/glyph.svg" alt="tiltmeter" width={24} height={24} priority />',
      ],
      ['<Link href="/models" className="hover:text-amber">', '<Link href="/models" prefetch={false} className="inline-flex items-center py-1 hover:text-amber">'],
      ['<Link href="/methodology" className="hover:text-amber">', '<Link href="/methodology" prefetch={false} className="inline-flex items-center py-1 hover:text-amber">'],
      ['<Link href="/docs" className="hover:text-amber">', '<Link href="/docs" prefetch={false} className="inline-flex items-center py-1 hover:text-amber">'],
    ],
  ],
  [
    "apps/web/components/DemoVideo.tsx",
    [
      [
        '<img src="/demo/tiltmeter-poster.png" alt="" className="w-full rounded-[10px]" />',
        '<img\n            src="/demo/tiltmeter-poster.png"\n            alt="The tiltmeter landing page as deployed, showing the calibration readout — the first frame of the recording."\n            className="w-full rounded-[10px]"\n          />',
      ],
      ['<a href="/models" className="underline hover:text-amber">', '<a href="/models" className="inline-block py-1 underline hover:text-amber">'],
      ['<a href="/methodology" className="underline hover:text-amber">', '<a href="/methodology" className="inline-block py-1 underline hover:text-amber">'],
    ],
  ],
  [
    "apps/web/components/Footer.tsx",
    [
      [
        '<a href="https://github.com/jamessuuu/tiltmeter" className="underline hover:text-amber">',
        '<a\n          href="https://github.com/jamessuuu/tiltmeter"\n          className="inline-flex items-center py-1 underline hover:text-amber"\n        >',
      ],
    ],
  ],
  [
    "apps/web/app/page.tsx",
    [
      [
        '              href="/methodology"\n              className="font-mono text-xs text-ink/55 underline decoration-rule underline-offset-4 hover:text-amber"',
        '              href="/methodology"\n              prefetch={false}\n              className="inline-flex items-center py-1 font-mono text-xs text-ink/55 underline decoration-rule underline-offset-4 hover:text-amber"',
      ],
      ['<Link href="/docs" className="underline decoration-rule underline-offset-4 hover:text-amber">', '<Link href="/docs" prefetch={false} className="underline decoration-rule underline-offset-4 hover:text-amber">'],
    ],
  ],
  [
    "apps/web/components/SuiteGrid.tsx",
    [['<Link href={`/suites/${suite.id}`} className="hover:text-amber">', '<Link href={`/suites/${suite.id}`} prefetch={false} className="hover:text-amber">']],
  ],
];

for (const [rel, pairs] of edits) {
  const path = resolve(ROOT, rel);
  let src = readFileSync(path, "utf8");
  for (const [from, to] of pairs) {
    if (!src.includes(from)) {
      console.log(`MISS ${rel} :: ${from.slice(0, 60)}`);
      continue;
    }
    src = src.split(from).join(to);
  }
  writeFileSync(path, src);
  console.log(`patched ${rel}`);
}
