export type {
  AcharBootstrap,
  AcharDiagnostic,
  AcharFixtureSummary,
  AcharGeneratedFile,
  AcharGenerationResult,
  AcharInput,
  AcharMachineProfileSummary,
  AcharValidationResult,
} from './application/achar-service';
export {
  bootstrapAchar,
  generateAcharFiles,
  readGeneratedFile,
  resolveWorkspaceRoot,
  validateAcharInput,
} from './application/achar-service';
export {
  DirectionEnum,
  FeedRateModeEnum,
  PlaneEnum,
  StateEnum,
} from './common/enums';
export type {
  CommandOptions,
  EmissionDiagnostic,
  GCodeWord,
  GCodeWordLetter,
} from './lib/builder';
export { Builder } from './lib/builder';
export type { BuiltInPost } from './lib/builtin-posts';
export {
  builtinPosts,
  listBuiltinPosts,
  resolveBuiltinPost,
} from './lib/builtin-posts';
export { registerDefaultPost } from './lib/default-post';
export type { BuilderDriver } from './lib/driver';
export { defineDriver } from './lib/driver';
export { ValidationError } from './lib/errors';
export type { EventListenerMetadata } from './lib/event';
export type { EventConsumer } from './lib/event-consumer';
export { runConsumer, runConsumers } from './lib/event-consumer';
export type {
  DiscoverFixturesOptions,
  FixtureManifest,
  ResolvedFixture,
} from './lib/fixture';
export { discoverFixtures, loadFixture } from './lib/fixture';
export { Logger } from './lib/logger';
export type {
  BooleanFeatureSpec,
  EnumFeatureSpec,
  MachineFeatureSpec,
  MachineProfileFeatures,
  NumberFeatureSpec,
} from './lib/machine-features';
export {
  MACHINE_FEATURE_SPECS,
  machineFeatureSchema,
  parseMachineFeatures,
} from './lib/machine-features';
export type {
  LoadMachineProfileOptions,
  MachineProfile,
  MachineProfileHome,
  MachineProfilePostBinding,
  MachineProfileResolver,
  MachineProfileValidationOptions,
} from './lib/machine-profile';
export {
  loadMachineProfile,
  mergeMachineProfiles,
  parseMachineProfile,
  requireMachineProfile,
  resolveMachineProfileChain,
  validateMachineProfileCompatibility,
} from './lib/machine-profile';
export type { EventData } from './lib/parser';
export { Parser } from './lib/parser';
export type { ContextFactory } from './lib/post-context';
export { createPostContext, PostContext } from './lib/post-context';
export type { PostDefinitionApi } from './lib/post-definition';
export { definePost } from './lib/post-definition';
export type { PostLintIssue, PostLintRule } from './lib/post-lint';
export {
  formatPostLintIssues,
  lintPostSource,
  lintUnhandledEvents,
} from './lib/post-lint';
export type { PostModule, RegisterPost } from './lib/post-loader';
export { loadPost } from './lib/post-loader';
export type { PostPolicy } from './lib/post-policy';
export { definePostPolicy, extendPostPolicy } from './lib/post-policy';
export type {
  CompareOptions,
  CompareResult,
  CompareSummary,
  FileLifecycleIssue,
  GeneratedFile,
  PostTestConfig,
  PostTestResult,
  TraceFileLifecycle,
} from './lib/post-test';
export {
  assertPostMatchesReference,
  compareAgainstReference,
  compareFileLifecycle,
  compareGeneratedFiles,
  deriveProgramName,
  formatCompareResults,
  formatFileLifecycleIssues,
  generatePostFiles,
  generatePostProgram,
  parseTraceFile,
  readTraceFileLifecycle,
  streamTraceFile,
  summarizeCompareResults,
  testPost,
  writeGeneratedFiles,
  writeHtmlReport,
} from './lib/post-test';
export { expectPost, PostExpectation } from './lib/post-test-dsl';
export type {
  ProductDimensions,
  ProductPart,
  ProductProfile,
  ProductProfileDiagnostic,
  ProductProfileDiagnosticCode,
  ProductSetup,
  ProductTool,
} from './lib/product-profile';
export {
  createProductProfileConsumer,
  extractProductProfile,
} from './lib/product-profile';
export { Program } from './lib/program';
export type {
  SelectSetupEventsOptions,
  SetupOverview,
  SetupPartition,
  SetupSelectionResult,
  SetupSpan,
} from './lib/setup-selection';
export {
  availableSetups,
  createSetupPartitionConsumer,
  describeSetups,
  parseSetupSelection,
  partitionSetups,
  selectSetupEvents,
} from './lib/setup-selection';
export type {
  JobTiming,
  SetupTiming,
  SetupToolTiming,
  TimingReport,
  ToolTiming,
} from './lib/timing';
export {
  createTimingConsumer,
  extractTimingReport,
  formatDurationSeconds,
  parseDurationSeconds,
} from './lib/timing';
export type { ToolCatalogEntry } from './lib/tool-catalog';
export {
  createToolCatalogConsumer,
  extractToolCatalog,
} from './lib/tool-catalog';
export type {
  VmidAxis,
  VmidDefinition,
  VmidParameter,
  VmidValidationIssue,
} from './lib/vmid';
export {
  formatVmidSummary,
  formatVmidValidation,
  generateVmidTraceTypes,
  parseVmid,
  parseVmidFile,
  validateTraceAgainstVmid,
} from './lib/vmid';
export { RENAMED_SIEMENS_828D_DIALECT_IDS } from './posts/siemens-828d/dialect';
export type {
  CommandsType,
  DeepPartial,
  EventsType,
} from './types';
