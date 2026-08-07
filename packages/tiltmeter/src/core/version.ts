/**
 * The published package version, as a runtime constant (mirrors
 * snapgauge's core/version.ts pattern). Kept in sync with package.json by
 * hand at each release; there is no build step that injects it because
 * core must stay zero-I/O (no reading package.json off disk).
 */
export const TILTMETER_VERSION = "0.1.0-alpha.0";
