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
export type { EventListenerMetadata } from './lib/event';
export type {
  DiscoverFixturesOptions,
  FixtureManifest,
  ResolvedFixture,
} from './lib/fixture';
export { discoverFixtures, loadFixture } from './lib/fixture';
export { Logger } from './lib/logger';
export type {
  MachineProfile,
  MachineProfileFeatures,
  MachineProfileHome,
} from './lib/machine-profile';
export {
  loadMachineProfile,
  parseMachineProfile,
  requireMachineProfile,
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
  GeneratedFile,
  PostTestConfig,
  PostTestResult,
} from './lib/post-test';
export {
  assertPostMatchesReference,
  compareAgainstReference,
  deriveProgramName,
  formatCompareResults,
  generatePostFiles,
  generatePostProgram,
  parseTraceFile,
  summarizeCompareResults,
  testPost,
  writeGeneratedFiles,
  writeHtmlReport,
} from './lib/post-test';
export { expectPost, PostExpectation } from './lib/post-test-dsl';
export { Program } from './lib/program';
export type {
  JobTiming,
  SetupTiming,
  TimingReport,
  ToolTiming,
} from './lib/timing';
export {
  extractTimingReport,
  formatDurationSeconds,
  parseDurationSeconds,
} from './lib/timing';
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
export type {
  CommandsType,
  DeepPartial,
  EventsType,
} from './types';
