/**
 * The published package version, as a runtime constant (mirrors
 * snapgauge's core/version.ts pattern). Kept in sync with package.json by
 * hand at each release; there is no build step that injects it because
 * core must stay zero-I/O (no reading package.json off disk).
 */
export const TILTMETER_VERSION = "0.1.0-alpha.0";

/**
 * `runnerBehaviorVersion` (SPEC §3.3, §4 axis tuple) — bumped whenever a
 * change to the runner's scoring/attribution behavior would make an old
 * reading not directly comparable to a new one, even with an identical
 * suite and model. Distinct from TILTMETER_VERSION (the npm version, which
 * also changes for behavior-neutral releases like docs or CLI UX).
 */
export const RUNNER_BEHAVIOR_VERSION = 1;
