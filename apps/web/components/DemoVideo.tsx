/**
 * DESIGN-DIRECTION.md's demo recording: a scripted Playwright run against
 * the REAL deployed site (scripts/record-demo.mjs), never a screen capture
 * of someone clicking. Autoplay/muted/loop/playsInline, no browser chrome,
 * a poster frame so it never looks broken pre-load, and a visible adjacent
 * text alternative (not a hidden caption track) describing exactly what it
 * shows. `prefers-reduced-motion` gets the poster frame and a link instead
 * (globals.css's `.demo-video`/`.demo-reduced` swap) — never an
 * autoplaying video. Server Component: no client JS anywhere in this.
 */
export function DemoVideo() {
  return (
    <figure className="mt-4" data-testid="demo-video">
      <div className="border hairline bg-white/40">
        <video
          className="demo-video block w-full"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          poster="/demo/tiltmeter-poster.png"
          aria-hidden="true"
          data-testid="demo-video-el"
        >
          <source src="/demo/tiltmeter-demo.webm" type="video/webm" />
        </video>
        <div className="demo-reduced p-4" data-testid="demo-reduced">
          <img src="/demo/tiltmeter-poster.png" alt="" className="w-full border hairline" />
          <p className="mt-3 text-sm">
            Motion is reduced on this device, so the recording does not autoplay.{" "}
            <a href="/demo/tiltmeter-demo.webm" className="underline hover:text-amber">
              Play the recording
            </a>{" "}
            (webm, muted, no audio).
          </p>
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-ink/60 max-w-prose">
        A scripted run against the real deployed site (not a screen capture): the landing page, then{" "}
        <a href="/models" className="underline hover:text-amber">
          /models
        </a>{" "}
        — proving no leaderboard exists there — then{" "}
        <a href="/methodology" className="underline hover:text-amber">
          /methodology
        </a>
        .
      </figcaption>
    </figure>
  );
}
