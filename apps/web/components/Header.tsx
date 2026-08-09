import Image from "next/image";
import Link from "next/link";

/**
 * Site navigation, on every page. Added 2026-08-09: tiltmeter shipped with a
 * Footer (BRAND-KIT's required attribution) but no way to get from one page
 * to another except a browser back button or a link buried in body copy —
 * `/models`, `/methodology`, and `/docs` were each only reachable if you
 * already knew the URL. Static, server-rendered, no client JS: works
 * identically with JavaScript disabled, and wraps at narrow widths instead
 * of overlapping (checked at 320px).
 */
export function Header() {
  return (
    <header className="border-b hairline">
      <div className="mx-auto max-w-3xl px-6 py-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <Image src="/brand/glyph.svg" alt="" aria-hidden="true" width={24} height={24} priority />
          <span className="text-lg font-semibold tracking-tight group-hover:text-amber">tiltmeter</span>
        </Link>
        <nav aria-label="primary" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Link href="/models" className="hover:text-amber">
            models
          </Link>
          <Link href="/methodology" className="hover:text-amber">
            methodology
          </Link>
          <Link href="/docs" className="hover:text-amber">
            docs
          </Link>
        </nav>
      </div>
    </header>
  );
}
