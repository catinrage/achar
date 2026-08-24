import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  CompareOptions,
  CompareResult,
  EventData,
  MachineProfile,
  RegisterPost,
  ResolvedFixture,
  SetupSpan,
  VmidDefinition,
  VmidValidationIssue,
} from '@achar/core';
import {
  deriveProgramName,
  loadFixture,
  loadMachineProfile,
  loadPost,
  parseSetupSelection,
  parseTraceFile,
  parseVmidFile,
  partitionSetups,
  resolveBuiltinPost,
  selectSetupEvents,
  validateMachineProfileCompatibility,
  validateTraceAgainstVmid,
  writeHtmlReport,
} from '@achar/core';
import chalk from 'chalk';
import type { CliOptions } from './options';
import { printInfo } from './ui';

export interface RunInput {
  fixture?: ResolvedFixture;
  events: EventData[];
  tracePath: string;
  referenceDir?: string;
  outputDir?: string;
  programName: string;
  registerPost: RegisterPost;
  vmid?: VmidDefinition;
  machineProfile?: MachineProfile;
  vmidIssues: VmidValidationIssue[];
  /** Present only when `--setups` narrowed the run. */
  selectedSetups?: SetupSpan[];
}

/**
 * Locates a trace and its output directory, without parsing it.
 *
 * `resolveInput` loads a post, a VMID and a machine profile and materializes
 * every event, because a generation-family command needs all four. A command
 * that only summarises a trace needs none of them, and materializing the events
 * is the single largest allocation a parse makes — so those commands resolve
 * the target here and stream instead.
 */
export async function resolveTraceTarget(
  target: string,
  options: CliOptions,
): Promise<{ tracePath: string; outputDir?: string }> {
  const fixture = isFixtureTarget(target)
    ? await loadFixture(target)
    : undefined;
  return {
    tracePath: fixture?.trace ?? target,
    outputDir: typeof options.out === 'string' ? options.out : fixture?.out,
  };
}

export async function resolveInput(
  target: string,
  options: CliOptions,
  requirements: {
    fixture?: ResolvedFixture;
    requireOut?: boolean;
    requireReference?: boolean;
  } = {},
): Promise<RunInput> {
  const fixture =
    requirements.fixture ??
    (isFixtureTarget(target) ? await loadFixture(target) : undefined);
  const tracePath = fixture?.trace ?? target;
  const referenceDir =
    typeof options.reference === 'string'
      ? options.reference
      : fixture?.reference;
  const outputDir =
    typeof options.out === 'string' ? options.out : fixture?.out;
  const programName =
    typeof options.programName === 'string'
      ? options.programName
      : (fixture?.programName ?? deriveProgramName(tracePath));
  const loadedPost = await loadPost(
    typeof options.post === 'string' ? options.post : fixture?.post,
  );
  const vmid = await loadVmid(options, fixture);
  const machineProfile = await loadProfile(options, fixture);
  const parsedEvents = await parseTraceFile(tracePath);
  const selection = applySetupSelection(parsedEvents, options);
  const traceEvents = selection.events;
  const registerPost: RegisterPost = (program, context = {}) =>
    loadedPost(program, {
      ...context,
      machineProfile: context.machineProfile ?? machineProfile,
    });
  const vmidIssues = vmid ? validateTraceAgainstVmid(traceEvents, vmid) : [];
  vmidIssues.push(
    ...validateMachineProfileCompatibility(machineProfile, traceEvents, {
      vmid,
      // Only built-in posts declare a controller and a dialect list. A custom
      // post module is left unchecked: it can target whatever it likes.
      post: resolveBuiltinPost(
        typeof options.post === 'string' ? options.post : (fixture?.post ?? ''),
      ),
    }),
  );

  if (requirements.requireReference && !referenceDir) {
    throw new Error('Missing required option: --reference');
  }

  if (requirements.requireOut && !outputDir) {
    throw new Error('Missing required option: --out');
  }

  return {
    fixture,
    events: traceEvents,
    tracePath,
    referenceDir,
    outputDir,
    programName,
    registerPost,
    vmid,
    machineProfile,
    vmidIssues,
    selectedSetups: selection.selectedSetups,
  };
}

/**
 * Narrows the parsed events to `--setups` when it was given.
 *
 * VMID and machine-profile validation downstream then run against the events
 * that will actually be posted, which is the honest thing to check: a travel
 * limit broken by a setup nobody selected is not this run's problem.
 */
function applySetupSelection(
  events: EventData[],
  options: CliOptions,
): { events: EventData[]; selectedSetups?: SetupSpan[] } {
  if (typeof options.setups !== 'string') return { events };

  const partition = partitionSetups(events);
  const selection = parseSetupSelection(options.setups, partition.spans);
  const result = selectSetupEvents(events, selection, {
    partition,
    pruneTools: !options.keepAllTools,
  });

  if (partition.hasImplicitSetup) {
    result.warnings.unshift(
      'This trace runs jobs before its first @setup. Those jobs are part of ' +
        'the shared prologue and are always posted.',
    );
  }
  for (const warning of result.warnings) {
    printInfo(chalk.yellow(`! ${warning}`));
  }

  return { events: result.events, selectedSetups: result.selected };
}

async function loadVmid(
  options: CliOptions,
  fixture?: ResolvedFixture,
): Promise<VmidDefinition | undefined> {
  const vmidPath =
    typeof options.vmid === 'string' ? options.vmid : fixture?.vmid;
  return vmidPath ? parseVmidFile(vmidPath) : undefined;
}

async function loadProfile(
  options: CliOptions,
  fixture?: ResolvedFixture,
): Promise<MachineProfile | undefined> {
  const profilePath =
    typeof options.machineProfile === 'string'
      ? options.machineProfile
      : fixture?.machineProfile;
  return profilePath ? loadMachineProfile(profilePath) : undefined;
}

export function compareOptions(options: CliOptions): CompareOptions {
  return {
    allReferenceFiles: options.allReferenceFiles === true,
    maxDiffsPerFile: options.maxDiffs ?? 5,
    normalizeTimestamps:
      options.strict === true ? false : options.normalizeTimestamps !== false,
    strict: options.strict === true,
    ignoreLineNumbers: options.ignoreNumbering === true,
  };
}

export function isFixtureTarget(target: string): boolean {
  const resolved = path.resolve(target);
  return (
    existsSync(resolved) &&
    statSync(resolved).isDirectory() &&
    existsSync(path.join(resolved, 'achar.fixture.json'))
  );
}

export async function maybeWriteReport(
  options: CliOptions,
  results: CompareResult[],
): Promise<void> {
  if (typeof options.report === 'string') {
    await writeHtmlReport(results, path.resolve(options.report));
    printInfo(chalk.green(`Report written -> ${options.report}`));
  }
}

export function vmidExitCode(
  issues: VmidValidationIssue[],
  options: CliOptions,
): number {
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const hasWarnings = issues.some((issue) => issue.severity === 'warning');
  return hasErrors || (options.strictVmid === true && hasWarnings) ? 1 : 0;
}

export function requireString(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required option: --${name}`);
  }

  return value;
}

export function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
