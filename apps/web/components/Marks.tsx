/**
 * Decorative marks as inline SVG rather than font glyphs.
 *
 * The vendored woff2 files are subset to the Google Fonts latin range, so a
 * character outside it is simply not in the font and the browser falls
 * through to whatever face the visitor's system supplies — which on a
 * machine without coverage is tofu. Read straight out of the woff2 cmaps
 * (tools/screens/font-coverage.py): U+25B8 ▸ and U+2192 → are absent from
 * all three faces.
 *
 * U+2014 — is PRESENT and was never a finding. An earlier version of this
 * comment said it fell back, because the first coverage check inferred
 * presence from advance widths and Archivo's em-dash advance coincides with
 * the fallback's. Corrected once the cmap was read directly.
 *
 * The line drawn, and it is a judgement rather than a blanket rule:
 *
 *   DECORATIVE marks become SVG. A character that is its own text node,
 *   doing an icon's job, has no semantic role to preserve, carries the real
 *   tofu risk, and is not allowlistable.
 *
 *   SEMANTIC punctuation stays text. An arrow inline after link text
 *   ("methodology →"), or inside a mono hash chain ("a1b2c3 → d4e5f6"), is
 *   read, selected and copied as text. Converting it to SVG would break
 *   selection, copy-paste and screen-reader reading order to guard against
 *   a character every default platform font covers. That trade is not
 *   worth making.
 *
 * Both marks are em-sized so they scale with their surrounding type, draw
 * in `currentColor` so they inherit state and hover, and are aria-hidden
 * because in every use here an adjacent label already carries the meaning.
 */

/** Disclosure caret. Replaces U+25B8 ▸; rotates via the same transform utility the glyph used. */
export function CaretRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 2.5 L8.5 6 L4.5 9.5 Z" fill="currentColor" />
    </svg>
  );
}

/** Standalone directional arrow. Replaces a bare, decorative U+2192 → — never one sitting inline in a sentence. */
export function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2.5 8h10M9 4.5 12.5 8 9 11.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
