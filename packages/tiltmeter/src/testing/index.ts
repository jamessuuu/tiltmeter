/**
 * tiltmeter/testing — `FakeModelClient` + fixture builders ("./testing"
 * export, SPEC §2 / §14 M1). What makes the entire eval suite cost $0
 * (SPEC §6): a `ModelClient` implementation injected in place of the real
 * Anthropic client, scripted by item id + attempt.
 */
export {
  FakeModelClient,
  multiToolTrial,
  noResultTrial,
  noToolTrial,
  textTrial,
  toolUseTrial,
  type FakeModelClientOptions,
  type FakeScript,
} from "./fake-model-client.js";
export {
  allPassBehavior,
  buildFixtureSuite,
  flippedBehavior,
  scriptForBehavior,
  FIXTURE_PRESENTATION,
  type BuildFixtureSuiteOptions,
} from "./fixtures.js";
