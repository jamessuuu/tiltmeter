/**
 * tiltmeter — programmatic API ("." export, SPEC §2). This entry is
 * CORE-ONLY: isomorphic, zero I/O, no fetch, no fs, no env (SPEC §6). The
 * CLI lives behind the `tiltmeter` bin; node file I/O and the Anthropic
 * client live behind the node/client side of the boundary and are not part
 * of this published surface.
 *
 * M0: workspace scaffold only. The suite/presentation/scorer/reading/
 * compare/stats surface lands milestone by milestone — see docs/SPEC.md
 * §14 and CHANGELOG.md for what is real today.
 */
export { TILTMETER_VERSION } from "./core/version.js";
