import { Attribution } from "./Attribution";

/**
 * BRAND-KIT.md's required footer, on EVERY page: chip mark + "Built by
 * James Lorenz Santos" + link to agentjames.vercel.app + link to the
 * GitHub repo. Explicitly **no hire-me CTA** (PROGRAM.md D1 — the Vercel
 * Hobby non-commercial-use line; footer attribution is identity, not
 * advertising).
 *
 * The maker line is the shared attribution kit (attribution-kit v1): the chip mark
 * inline in currentColor, the portfolio and LinkedIn links with rel="me".
 */
export function Footer() {
  return (
    <footer className="border-t hairline mt-16 py-8 px-6 text-sm text-ink/70">
      <div className="mx-auto max-w-5xl flex flex-wrap items-center gap-3">
        <Attribution linkClassName="hover:text-amber" />
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/jamessuuu/tiltmeter"
          className="inline-flex items-center py-1 underline hover:text-amber"
        >
          github.com/jamessuuu/tiltmeter
        </a>
      </div>
    </footer>
  );
}
