import Image from "next/image";

/**
 * BRAND-KIT.md's required footer, on EVERY page: chip mark + "Built by
 * James Lorenz Santos" + link to agentjames.vercel.app + link to the
 * GitHub repo. Explicitly **no hire-me CTA** (PROGRAM.md D1 — the Vercel
 * Hobby non-commercial-use line; footer attribution is identity, not
 * advertising).
 */
export function Footer() {
  return (
    <footer className="border-t hairline mt-16 py-8 px-6 text-sm text-ink/70">
      <div className="mx-auto max-w-3xl flex flex-wrap items-center gap-3">
        <Image src="/brand/mark.svg" alt="" width={20} height={20} aria-hidden="true" />
        <span>
          Built by James Lorenz Santos ·{" "}
          <a href="https://agentjames.vercel.app" className="underline hover:text-amber">
            agentjames.vercel.app
          </a>{" "}
          ·{" "}
          <a href="https://github.com/jamessuuu/tiltmeter" className="underline hover:text-amber">
            github.com/jamessuuu/tiltmeter
          </a>
        </span>
      </div>
    </footer>
  );
}
