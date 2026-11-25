import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { EventData } from './parser';

export interface VmidAxis {
  name: string;
  type?: string;
  min?: number;
  max?: number;
  home?: number;
}

export interface VmidParameter {
  gppName: string;
  name?: string;
  type?: string;
  source: 'Param' | 'ParamJobs';
}

export interface VmidDefinition {
  file?: string;
  machine: Record<string, string>;
  axes: VmidAxis[];
  postProcessors: string[];
  parameters: VmidParameter[];
}

export interface VmidValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  event?: string;
  key?: string;
}

export interface VmidValidationOptions {
  /**
   * Skip the strict `StartOfFile.VMID_file` vs `<Machine Name>` check when
   * machine compatibility explicitly permits adapting a 4-axis trace onto a
   * 3-axis machine.
   */
  allowTraceVmidMismatch?: boolean;
  /** Label used in rotary rejection messages. */
  rotaryTargetLabel?: string;
  /**
   * Skip running `findTraceRotaryIssues` here when the caller is running it
   * via `validateMachineProfileCompatibility` so each finding is emitted once.
   */
  skipRotaryUsageCheck?: boolean;
}

export async function parseVmidFile(vmidPath: string): Promise<VmidDefinition> {
  return {
    ...parseVmid(await readFile(vmidPath, 'utf-8')),
    file: path.resolve(vmidPath),
  };
}

export function parseVmid(source: string): VmidDefinition {
  const machine = parseFirstAttributes(source, 'Machine');
  const axes = parseElements(source, 'Axis')
    .map((attrs) => ({
      name: attrs.Name ?? '',
      type: attrs.Type,
      min: parseOptionalNumber(attrs.MinLim),
      max: parseOptionalNumber(attrs.MaxLim),
      home: parseOptionalNumber(attrs.HomeRef),
    }))
    .filter((axis) => axis.name.length > 0);
  const postProcessors = parseElements(source, 'PostProcessor')
    .map((attrs) => attrs.Name)
    .filter((name): name is string => typeof name === 'string');
  const parameters: VmidParameter[] = [
    ...parseElements(source, 'Param').map((attrs) => ({
      gppName: attrs.GppName ?? '',
      name: attrs.Name,
      type: attrs.Type,
      source: 'Param' as const,
    })),
    ...parseElements(source, 'ParamJobs').map((attrs) => ({
      gppName: attrs.GppName ?? '',
      name: attrs.Name,
      type: attrs.Type,
      source: 'ParamJobs' as const,
    })),
  ].filter((param) => param.gppName.length > 0);

  return {
    machine,
    axes,
    postProcessors,
    parameters,
  };
}

/**
 * True when the VMID declares any rotary axis (`A`/`B`/`C` or `Type="1"`).
 */
export function vmidHasRotaryAxis(vmid: VmidDefinition): boolean {
  return vmid.axes.some(
    (axis) => /^[abc]$/i.test(axis.name) || axis.type === '1',
  );
}

/**
 * True when the VMID models a standard 3-axis linear machine with no rotary axis.
 */
export function isThreeAxisVmid(vmid: VmidDefinition | undefined): boolean {
  return (
    vmid !== undefined && vmid.axes.length === 3 && !vmidHasRotaryAxis(vmid)
  );
}

export function validateTraceAgainstVmid(
  events: EventData[],
  vmid: VmidDefinition,
  options: VmidValidationOptions = {},
): VmidValidationIssue[] {
  const issues: VmidValidationIssue[] = [];
  const parameterNames = new Set(vmid.parameters.map((param) => param.gppName));
  const axisNames = new Set(vmid.axes.map((axis) => axis.name.toUpperCase()));
  const startOfFile = events.find(
    (event) => event._eventName === 'StartOfFile',
  );
  const traceVmidName = stringValue(startOfFile?.VMID_file);
  const machineName = vmid.machine.Name;

  if (
    !options.allowTraceVmidMismatch &&
    traceVmidName &&
    machineName &&
    normalizeName(traceVmidName) !== normalizeName(machineName)
  ) {
    issues.push({
      severity: 'error',
      event: 'StartOfFile',
      key: 'VMID_file',
      message: `Trace VMID ${traceVmidName} does not match VMID machine ${machineName}.`,
    });
  }

  for (const event of events) {
    for (const [key, value] of Object.entries(event)) {
      if (key.startsWith('_')) continue;

      const axisName = axisFieldName(key);
      if (axisName && typeof value === 'number' && !axisNames.has(axisName)) {
        issues.push({
          severity: 'error',
          event: String(event._eventName),
          key,
          message: `Trace uses ${axisName} axis, but the VMID does not define it.`,
        });
        continue;
      }

      if (looksLikeUserParameter(key) && !parameterNames.has(key)) {
        issues.push({
          severity: 'warning',
          event: String(event._eventName),
          key,
          message: `Trace user parameter ${key} is not declared in the VMID.`,
        });
      }
    }
  }

  if (isThreeAxisVmid(vmid) && !options.skipRotaryUsageCheck) {
    const targetLabel =
      options.rotaryTargetLabel ??
      (machineName ? `VMID ${machineName}` : 'this 3-axis VMID');
    issues.push(
      ...findTraceRotaryIssues(events, targetLabel, {
        includeSingleLetterAxes: false,
      }),
    );
  }

  return uniqueIssues(issues);
}

export function formatVmidSummary(vmid: VmidDefinition): string {
  const name = vmid.machine.Name ?? 'unknown machine';
  const axes = vmid.axes.map((axis) => axis.name).join(', ') || 'none';

  return `${name}: ${vmid.parameters.length} user parameters, axes ${axes}`;
}

export function formatVmidValidation(issues: VmidValidationIssue[]): string {
  if (issues.length === 0) {
    return 'VMID validation passed';
  }

  return issues
    .map((issue) => {
      const location =
        issue.event && issue.key ? ` (${issue.event}.${issue.key})` : '';
      return `${issue.severity.toUpperCase()}: ${issue.message}${location}`;
    })
    .join('\n');
}

export function generateVmidTraceTypes(
  vmid: VmidDefinition,
  options: { interfaceName?: string } = {},
): string {
  const interfaceName = options.interfaceName ?? 'VmidTraceExtensions';
  const globals = vmid.parameters.filter((item) => item.source === 'Param');
  const jobs = vmid.parameters.filter((item) => item.source === 'ParamJobs');
  const fields = (parameters: VmidParameter[]) =>
    [...new Map(parameters.map((item) => [item.gppName, item])).values()]
      .sort((left, right) => left.gppName.localeCompare(right.gppName))
      .map(
        (item) =>
          `  ${typescriptProperty(item.gppName)}?: ${vmidParameterType(item)};`,
      )
      .join('\n');

  return [
    '// Generated by achar vmid-types. Do not edit by hand.',
    "import type { EventsType } from 'achar';",
    '',
    `export interface ${interfaceName} {`,
    fields(globals),
    '}',
    '',
    `export interface ${interfaceName}StartOfJob {`,
    fields(jobs),
    '}',
    '',
    `export type ${interfaceName}Job = EventsType['StartOfJob'] & ${interfaceName}StartOfJob;`,
    '',
  ].join('\n');
}

function parseFirstAttributes(
  source: string,
  tagName: string,
): Record<string, string> {
  const match = source.match(new RegExp(`<${tagName}\\b([^>]*)>`));
  return match ? parseAttributes(match[1]) : {};
}

function parseElements(
  source: string,
  tagName: string,
): Array<Record<string, string>> {
  const elements: Array<Record<string, string>> = [];
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, 'g');

  for (const match of source.matchAll(pattern)) {
    elements.push(parseAttributes(match[1]));
  }

  return elements;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w:-]*)="([^"]*)"/g;

  for (const match of source.matchAll(pattern)) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeName(value: string): string {
  return value.replace(/\.[^.]+$/, '').toLowerCase();
}

function axisFieldName(key: string): string | undefined {
  return /^[xyzabc]$/i.test(key) ? key.toUpperCase() : undefined;
}

function looksLikeUserParameter(key: string): boolean {
  return /^(?:C\d+_|MISC_|Iteration_|ts_|[bins][A-Z0-9_])/.test(key);
}

function uniqueIssues(issues: VmidValidationIssue[]): VmidValidationIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.event}:${issue.key}:${issue.message}`;
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function vmidParameterType(parameter: VmidParameter): string {
  const type = parameter.type?.toLowerCase();
  if (type?.includes('string') || parameter.gppName.startsWith('s')) {
    return 'string';
  }
  if (type?.includes('bool')) return 'boolean';
  return 'number';
}

const ROTARY_SKIP_EVENTS = new Set([
  'StartOfFile',
  'PlaneData',
  'HomeData',
  'Tmatrix',
]);

const ROTARY_ONLY_EVENTS = new Set([
  'FourthAxis',
  'Move4x',
  'Line4xCartesian',
  'Line4xPolar',
  'Move5x',
  'Line5x',
]);

const TRACE_ROTARY_KEYS = [
  'apos',
  'bpos',
  'cpos',
  'anext',
  'bnext',
  'cnext',
  'first_axis_angle',
  'second_axis_angle',
] as const;

const SINGLE_LETTER_ROTARY_KEYS = ['a', 'b', 'c'] as const;

const ROTARY_ANGLE_EPSILON = 1e-6;

export interface FindTraceRotaryOptions {
  /** Include single-letter `a`/`b`/`c` keys (handled separately by VMID axis checks). */
  includeSingleLetterAxes?: boolean;
}

/**
 * Finds rotary (4th/5th axis) usage in a trace or selected-setup event stream.
 *
 * Ignores static plane definitions (`PlaneData`, `HomeData`, `Tmatrix`) and
 * dummy zero rotary fields emitted on pure 3-axis jobs in a 4-axis trace
 * (`anext: 0`, `cpos: 0`), reporting at most one error per setup scope so the
 * operator sees which setups cannot run on a 3-axis machine.
 */
export function findTraceRotaryIssues(
  events: EventData[],
  targetLabel = 'this 3-axis machine',
  options: FindTraceRotaryOptions = {},
): VmidValidationIssue[] {
  const includeSingleLetterAxes = options.includeSingleLetterAxes ?? true;
  const keysToCheck = includeSingleLetterAxes
    ? [...TRACE_ROTARY_KEYS, ...SINGLE_LETTER_ROTARY_KEYS]
    : TRACE_ROTARY_KEYS;

  const issues: VmidValidationIssue[] = [];
  const reportedScopes = new Set<string>();
  let sequentialSetupIndex = 0;
  let setupIndex = 0;
  let setupName: string | undefined;
  let jobName: string | undefined;

  for (const event of events) {
    const eventName = String(event._eventName);
    if (eventName === 'Setup') {
      sequentialSetupIndex += 1;
      setupIndex =
        typeof event._setupIndex === 'number'
          ? event._setupIndex
          : sequentialSetupIndex;
      setupName = stringValue(event.setup_name);
      jobName = undefined;
      continue;
    }
    if (eventName === 'StartOfJob') {
      jobName = stringValue(event.job_name);
    }

    const hit = detectRotaryEventReason(event, eventName, keysToCheck);
    if (hit) {
      const scope = setupIndex > 0 ? `setup:${setupIndex}` : 'program';
      if (!reportedScopes.has(scope)) {
        reportedScopes.add(scope);
        const location = formatRotaryLocation(setupIndex, setupName, jobName);
        issues.push({
          severity: 'error',
          event: eventName,
          key: hit.key,
          message: `${location}uses a rotary axis (${hit.description}), which ${targetLabel} does not allow.`,
        });
      }
    }

    if (eventName === 'EndOfJob') {
      jobName = undefined;
    }
  }

  return issues;
}

function detectRotaryEventReason(
  event: EventData,
  eventName: string,
  keysToCheck: readonly string[],
): { key: string; description: string } | undefined {
  if (ROTARY_SKIP_EVENTS.has(eventName)) return undefined;

  if (ROTARY_ONLY_EVENTS.has(eventName)) {
    return { key: eventName, description: `event ${eventName}` };
  }

  if (eventName === 'StartOfJob') {
    if (event.used_in_transform_4x === 1) {
      return {
        key: 'used_in_transform_4x',
        description: 'used_in_transform_4x = 1',
      };
    }
    if (event.X5_job === 1) {
      return { key: 'X5_job', description: 'X5_job = 1' };
    }
  }

  const rotAxisType = stringValue(event.rot_axis_type);
  if (rotAxisType && rotAxisType !== 'axis4_none') {
    return {
      key: 'rot_axis_type',
      description: `rot_axis_type = ${rotAxisType}`,
    };
  }

  for (const key of keysToCheck) {
    const value = event[key];
    if (typeof value === 'number' && Math.abs(value) > ROTARY_ANGLE_EPSILON) {
      return { key, description: `${key} = ${value}` };
    }
  }

  return undefined;
}

function formatRotaryLocation(
  setupIndex: number,
  setupName: string | undefined,
  jobName: string | undefined,
): string {
  const parts: string[] = [];
  if (setupIndex > 0) {
    parts.push(
      setupName ? `Setup ${setupIndex} (${setupName})` : `Setup ${setupIndex}`,
    );
  }
  if (jobName) parts.push(`job ${jobName}`);
  return parts.length > 0 ? `${parts.join(', ')}: ` : '';
}

function typescriptProperty(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}
