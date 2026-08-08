import type { NextConfig } from "next";

/** Next's own `NextConfig["webpack"]` types its `config` parameter as `any` (webpack's real `Configuration` type is not part of `next`'s public type surface) — this minimal local shape is enough to type-check the one field this project touches, without adding `webpack` as a direct dependency just for its types. */
interface WebpackConfigLike {
  resolve?: { extensionAlias?: Record<string, string[]>; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * SPEC §7/§10/§13: "Zero API routes, zero DB, zero writes → the §4.2 'no
 * unauthenticated write path' bar is met structurally." `output: "export"`
 * is the structural guarantee, not just a convention — Next.js itself
 * refuses to build if any route tries to opt into dynamic rendering
 * (cookies/headers/searchParams-driven behavior, a route handler that
 * isn't fully static) once this is set. Every page ALSO declares
 * `export const dynamic = "error"` itself (SPEC §7's literal words) as a
 * second, redundant, self-documenting guard at the route level.
 */
const nextConfig: NextConfig = {
  output: "export",
  // Directory-based output (`<route>/index.html`) instead of the default
  // sibling-file form (`<route>.html`) — the sibling form collides with
  // the same-named directory Next.js ALSO writes RSC-prefetch payloads
  // into for every dynamic route (`/suites/<id>/__next._full.txt` etc),
  // which trips up generic static file servers (`serve`, most CDNs/nginx
  // configs) that see the directory and a same-named file and pick
  // wrong. Directory+index.html is the universally-supported convention.
  trailingSlash: true,
  // The workspace package ships TS source under its "." export (dev
  // resolution) — Next transpiles it as part of this build rather than
  // requiring a separate `tsc` pass first.
  transpilePackages: ["tiltmeter"],
  images: {
    // Static export cannot run the image optimization server; every image
    // on this site is a build-time-generated brand SVG anyway (SPEC's
    // brand.mjs), so there is nothing to optimize.
    unoptimized: true,
  },
  // `tiltmeter`'s source uses TS NodeNext-style `.js`-suffixed specifiers
  // pointing at sibling `.ts` files (SPEC §6's own module layout — correct
  // for `tsc`/Vitest, both of which understand the convention natively).
  // Turbopack (Next 16's default) has an open bug resolving this through
  // `transpilePackages` for a monorepo package's OWN inherited/re-exported
  // internal imports (vercel/next.js#85315/#85316/#63230) — the documented
  // workaround is `next build --webpack` (this app's `build` script), and
  // webpack itself needs this standard `resolve.extensionAlias` to follow
  // the same `.js`->`.ts` convention.
  webpack(config: WebpackConfigLike) {
    config.resolve = { ...config.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"] } };
    return config;
  },
};

export default nextConfig;
