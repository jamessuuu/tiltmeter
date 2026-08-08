/**
 * tiltmeter — programmatic API ("." export, SPEC §2). This entry is
 * CORE-ONLY: isomorphic, zero I/O, no fetch, no fs, no env (SPEC §6). The
 * CLI lives behind the `tiltmeter` bin; node file I/O and the Anthropic
 * client live behind the node/client side of the boundary and are not part
 * of this published surface.
 *
 * See docs/SPEC.md §14 and CHANGELOG.md for what is real today.
 */
export { TILTMETER_VERSION, RUNNER_BEHAVIOR_VERSION } from "./core/version.js";
export { sha256Hex } from "./core/sha256.js";
export { canonicalStringify, jcsCanonical, JsonObjectSchema, JsonValueSchema, type Json, type JsonObject } from "./core/canonical.js";
export { bernoulliTrial, mulberry32, randomIndex, seedFromHex8, shuffleInPlace, type Rng } from "./core/prng.js";
export { TiltmeterError, isTiltmeterError, type ErrorCode } from "./core/errors.js";
export {
  ArtifactSchema,
  ArtifactSourceSchema,
  ExpectSchema,
  ItemSchema,
  meetsNegativesQuota,
  parseSuite,
  PolaritySchema,
  ProbeTypeSchema,
  RetirementSchema,
  SamplingSchema,
  SuiteSchema,
  suiteSpecHash,
  activeItems,
  type Artifact,
  type ArtifactSource,
  type Expect,
  type Item,
  type Polarity,
  type ProbeType,
  type Retirement,
  type Sampling,
  type Suite,
} from "./core/suite.js";
export {
  parsePresentation,
  presentationHash,
  PresentationSchema,
  renderPresentation,
  samplingPolicyHash,
  ToolChoiceSchema,
  type Presentation,
} from "./core/presentation.js";
export type {
  ModelClient,
  ModelTrialResponse,
  NoResultTrial,
  RequestPlan,
  StopReason,
  TokenUsage,
  ToolChoice,
  ToolDef,
  ToolUseBlock,
  TrialResult,
  UserMessage,
} from "./core/model-client.js";
export { score, type ScoreResult, type TrialOutcome as ScoreOutcome } from "./core/scorers.js";
export {
  AXIS_TUPLE_KEYS,
  axisTupleOf,
  CompletenessSchema,
  ItemReadingSchema,
  parseReading,
  ReadingAxesSchema,
  ReadingSchema,
  ReadingStatusSchema,
  TrialOutcomeSchema,
  TrialSchema,
  type AxisTuple,
  type AxisTupleKey,
  type Completeness,
  type ItemReading,
  type Reading,
  type ReadingAxes,
  type ReadingStatus,
  type Trial,
  type TrialOutcome,
} from "./core/reading.js";
export { computeMetrics, runSuite, type RunContext } from "./core/run.js";
export {
  buildItemComparisons,
  classify,
  classifyBootstrap,
  compareReadings,
  pairsForMetric,
  worstMetricVerdict,
  type Comparison,
  type ComparisonAxis,
  type ItemComparison,
  type ItemLabel,
  type MetricDelta,
  type MetricVerdict,
  type Verdict,
} from "./core/compare.js";
export { pairedPercentileBootstrap, type BootstrapResult, type ItemPair } from "./core/stats.js";
export {
  CALIBRATION_BASE_RATE,
  CALIBRATION_BOOTSTRAP_B,
  CALIBRATION_DEGRADED_COUNT,
  CALIBRATION_DEGRADED_RATE,
  CALIBRATION_ITEM_COUNT,
  CALIBRATION_K,
  CALIBRATION_TRIALS,
  DETECTION_POWER_GATE_MIN_RATE,
  FALSE_POSITIVE_GATE_MAX_FIRES,
  runNullPairCalibration,
  runPlantedDegradationCalibration,
  type CalibrationResult,
} from "./core/calibration.js";
export {
  assertRebaselined,
  hasRebaselineRunGroup,
  isStale,
  staleReadings,
} from "./core/rebaseline.js";
export {
  appendEntry,
  computeEntryHash,
  IndexEntryCellSchema,
  IndexEntrySchema,
  parseIndex,
  serializeIndex,
  verifyChain,
  type ChainVerifyResult,
  type IndexEntry,
  type IndexEntryCell,
  type IndexEntryFields,
} from "./core/index-chain.js";
export {
  readingBytes,
  verifyCorpus,
  verifyGitPreRegistration,
  verifyReadingBodyHash,
  type CorpusVerifyResult,
  type GitPreRegistrationNotImplemented,
  type ReadingVerifyResult,
} from "./core/verify.js";
