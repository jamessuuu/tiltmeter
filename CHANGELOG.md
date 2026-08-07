# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: semver.

## [Unreleased]

### Added
- M0: pnpm workspace (`packages/tiltmeter`), TS strict + `noUncheckedIndexedAccess`,
  ESLint 9 flat config with the `src/core` + `src/testing` no-node-builtins /
  no-fetch boundary rule (docs/SPEC.md §6), Vitest 4 unit+eval projects,
  five-stage CI (typecheck → lint → unit → e2e:smoke → eval) plus build +
  pack-check guards, MIT license with brand-asset carve-out, SECURITY.md
  (the §9/§13 checklist, committed ahead of the surfaces it governs),
  docs/SPEC.md committed. `apps/web` (the static site, docs/SPEC.md §10) is
  **deferred past M0** — every Vercel deploy on this machine is James-gated
  program-wide, and there is no web app to deploy yet in any case; `e2e:smoke`
  is an explicit `echo` no-op until M6 rather than a silently-skipped stage.
