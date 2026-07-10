import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { EventData } from './parser';
import type { VmidDefinition, VmidValidationIssue } from './vmid';

export interface MachineProfileFeatures {
  toolMeasurementProgram?: boolean;
  toolMeasurementProgramDeferred?: boolean;
  mainToolListComments?: boolean;
  dwellAfterCoolantOn?: boolean;
  dwellAfterCoolantOff?: boolean;
  cancelAirCoolantSchedule?: boolean;
  forceInitialApproachPosition?: boolean;
  inlineFeedRateMode?: boolean;
  compactCoordinates?: boolean;
}

export interface MachineProfileHome {
  x?: number;
  y?: number;
  z?: number;
}

export interface MachineProfile {
  id: string;
  name?: string;
  controller?: string;
  axes?: number;
  features?: MachineProfileFeatures;
  home?: MachineProfileHome;
  returnHome?: MachineProfileHome;
}

export async function loadMachineProfile(
  profilePath: string,
): Promise<MachineProfile> {
  const resolvedPath = path.resolve(profilePath);
  const parsed = JSON.parse(await readFile(resolvedPath, 'utf-8')) as unknown;
  return parseMachineProfile(parsed, resolvedPath);
}

export function parseMachineProfile(
  value: unknown,
  source = 'machine profile',
): MachineProfile {
  if (!isRecord(value)) {
    throw new Error(`${source} must be a JSON object.`);
  }

  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    throw new Error(`${source} must define a non-empty string id.`);
  }

  return {
    id: value.id,
    name: optionalString(value.name, source, 'name'),
    controller: optionalString(value.controller, source, 'controller'),
    axes: optionalPositiveInteger(value.axes, source, 'axes'),
    features: parseFeatures(value.features, source),
    home: parseHome(value.home, source, 'home'),
    returnHome: parseHome(value.returnHome, source, 'returnHome'),
  };
}

export function validateMachineProfileCompatibility(
  profile: MachineProfile | undefined,
  events: EventData[],
  vmid?: VmidDefinition,
): VmidValidationIssue[] {
  if (!profile) return [];

  const issues: VmidValidationIssue[] = [];
  const traceAxes = traceAxisCount(events);
  if (
    profile.axes !== undefined &&
    traceAxes !== undefined &&
    profile.axes !== traceAxes
  ) {
    issues.push({
      severity: 'error',
      event: 'StartOfFile',
      key: 'iNumberOfAixs',
      message: `Machine profile ${profile.id} declares ${profile.axes} axes, but the trace declares ${traceAxes}.`,
    });
  }

  if (
    profile.axes !== undefined &&
    vmid?.axes.length !== undefined &&
    profile.axes !== vmid.axes.length
  ) {
    issues.push({
      severity: 'error',
      key: 'axes',
      message: `Machine profile ${profile.id} declares ${profile.axes} axes, but the VMID defines ${vmid.axes.length}.`,
    });
  }

  return issues;
}

export function requireMachineProfile(
  profile: MachineProfile | undefined,
  reason = 'this generation path',
): MachineProfile {
  if (!profile) {
    throw new Error(`Machine profile is missing; ${reason} requires one.`);
  }
  return profile;
}

function traceAxisCount(events: EventData[]): number | undefined {
  const startOfFile = events.find(
    (event) => event._eventName === 'StartOfFile',
  );
  const value = startOfFile?.iNumberOfAixs;
  return typeof value === 'number' ? value : undefined;
}

function parseFeatures(
  value: unknown,
  source: string,
): MachineProfileFeatures | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${source}.features must be a JSON object.`);
  }

  return {
    toolMeasurementProgram: optionalBoolean(
      value.toolMeasurementProgram,
      source,
      'features.toolMeasurementProgram',
    ),
    toolMeasurementProgramDeferred: optionalBoolean(
      value.toolMeasurementProgramDeferred,
      source,
      'features.toolMeasurementProgramDeferred',
    ),
    mainToolListComments: optionalBoolean(
      value.mainToolListComments,
      source,
      'features.mainToolListComments',
    ),
    dwellAfterCoolantOn: optionalBoolean(
      value.dwellAfterCoolantOn,
      source,
      'features.dwellAfterCoolantOn',
    ),
    dwellAfterCoolantOff: optionalBoolean(
      value.dwellAfterCoolantOff,
      source,
      'features.dwellAfterCoolantOff',
    ),
    cancelAirCoolantSchedule: optionalBoolean(
      value.cancelAirCoolantSchedule,
      source,
      'features.cancelAirCoolantSchedule',
    ),
    forceInitialApproachPosition: optionalBoolean(
      value.forceInitialApproachPosition,
      source,
      'features.forceInitialApproachPosition',
    ),
    inlineFeedRateMode: optionalBoolean(
      value.inlineFeedRateMode,
      source,
      'features.inlineFeedRateMode',
    ),
    compactCoordinates: optionalBoolean(
      value.compactCoordinates,
      source,
      'features.compactCoordinates',
    ),
  };
}

function parseHome(
  value: unknown,
  source: string,
  key: string,
): MachineProfileHome | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${source}.${key} must be a JSON object.`);
  }

  return {
    x: optionalNumber(value.x, source, `${key}.x`),
    y: optionalNumber(value.y, source, `${key}.y`),
    z: optionalNumber(value.z, source, `${key}.z`),
  };
}

function optionalString(
  value: unknown,
  source: string,
  key: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${source}.${key} must be a string.`);
  }
  return value;
}

function optionalBoolean(
  value: unknown,
  source: string,
  key: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${source}.${key} must be a boolean.`);
  }
  return value;
}

function optionalNumber(
  value: unknown,
  source: string,
  key: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${source}.${key} must be a finite number.`);
  }
  return value;
}

function optionalPositiveInteger(
  value: unknown,
  source: string,
  key: string,
): number | undefined {
  const parsed = optionalNumber(value, source, key);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${source}.${key} must be a positive integer.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
