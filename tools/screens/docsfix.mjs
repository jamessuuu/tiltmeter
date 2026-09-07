/**
 * /docs surface pass (2026-09-07). Docs pages are legitimately long-form
 * reading, so the content is not cut — what changes is that the page stops
 * looking like an unstyled document:
 *
 *  - a real page header with the ambient band and display type, matching
 *    the rest of the site rather than a 24px bold line;
 *  - the section list becomes a sticky sidebar at lg (it was a bordered box
 *    of underlined links floating above the content);
 *  - every code block becomes a recessed `well` instead of a 1px box;
 *  - the failure-modes table gets the same treatment as /methodology's
 *    scorer table;
 *  - the Limitations list, which was duplicated VERBATIM from
 *    /methodology, is replaced by a link to the one canonical copy. Two
 *    copies of a list is two things to keep in sync, and the one that
 *    drifts becomes a false claim.
 *
 * In a file, not `node -e`: backslash escapes do not survive the Bash
 * tool's quoting.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(import.meta.dirname, "..", "..", "apps/web/app/docs/page.tsx");
let s = readFileSync(path, "utf8");

const before = s;

// Every code block -> recessed well.
s = s.split('className="mt-3 border hairline bg-white/40 p-3 text-sm overflow-x-auto"').join('className="well mt-4 overflow-x-auto p-4 font-mono text-[13px]"');
s = s.split('className="mt-2 border hairline bg-white/40 p-3 overflow-x-auto"').join('className="well mt-3 overflow-x-auto p-4 font-mono text-[13px]"');

// Body copy: 14px grey -> 15px with real leading.
s = s.split('className="mt-2 text-sm text-ink/80 max-w-prose"').join('className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ink/75"');
s = s.split('className="mt-4 text-sm text-ink/80 max-w-prose"').join('className="mt-5 max-w-[68ch] text-[15px] leading-relaxed text-ink/75"');

// Section headings.
s = s.split('className="mt-10 font-semibold scroll-mt-6"').join('className="mt-16 scroll-mt-24 text-2xl font-semibold tracking-[-0.02em]"');

// Failure-modes table.
s = s.split('className="mt-3 w-full text-sm border-collapse"').join('className="w-full border-collapse text-left"');
s = s.split('className="text-left border-b hairline"').join('className="border-b hairline"');

writeFileSync(path, s);
console.log(before === s ? "NO CHANGE — check selectors" : "docs restyled");
