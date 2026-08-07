/**
 * tiltmeter/testing — `FakeModelClient` + fixture builders ("./testing"
 * export, SPEC §2). What makes the entire eval suite cost $0 (SPEC §6): a
 * `ModelClient` implementation injected in place of the real Anthropic
 * client, scripted by item id + attempt.
 *
 * M0: not yet implemented — lands at M1 (SPEC §14). Importing this module
 * today gets you an empty surface, not a broken one; the "./testing"
 * export path and its publish-shape (dist resolution, pack-check) are
 * exercised from M0 so M1 is additive rather than a new export to wire up.
 */
export {};
