import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  CompareOptions,
  CompareResult,
  EventData,
  MachineProfile,
  RegisterPost,
  ResolvedFixture,
  VmidDefinition,
  VmidValidationIssue,
} from '@achar/core';
import {
  deriveProgramName,
  loadFixture,
  loadMachineProfile,
  loadPost,
  parseTraceFile,
  parseVmidFile,
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
  const traceEvents = await parseTraceFile(tracePath);
  const registerPost: RegisterPost = (program, context = {}) =>
    loadedPost(program, {
      ...context,
      machineProfile: context.machineProfile ?? machineProfile,
    });
  const vmidIssues = vmid ? validateTraceAgainstVmid(traceEvents, vmid) : [];
  vmidIssues.push(
    ...validateMachineProfileCompatibility(machineProfile, traceEvents, vmid),
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
  };
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
