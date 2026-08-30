import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MachineProfileFeatures } from './machine-features';
import { parseMachineFeatures } from './machine-features';
import type { EventData } from './parser';
import type { VmidDefinition, VmidValidationIssue } from './vmid';

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
  /**
   * Names another profile this one starts from.
   *
   * A shop's machines overlap far more than they differ, and a profile that
   * restates every shared value is a profile that drifts from its siblings
   * the first time one of them is corrected. Stating only the delta means
   * there is one place to fix.
   *
   * What the reference *means* is the loader's business — a path on disk, a
   * machine id in the workshop — because where profiles live genuinely
   * differs by context. What the merge does is not: see
   * `mergeMachineProfiles`.
   */
  extends?: string;
  /**
   * Names the output convention this machine's G-code must follow.
   *
   * Resolved by the post, which owns the list of dialects it can speak. An
   * absent value means the post's stock dialect.
   */
  dialect?: string;
  features?: MachineProfileFeatures;
  home?: MachineProfileHome;
  returnHome?: MachineProfileHome;
}

export interface LoadMachineProfileOptions {
  /**
   * Confines the `extends` chain to this directory tree.
   *
   * Callers that already sandbox the profile path — the MCP server, which
   * only accepts paths inside its workspace — must pass their root, or a
   * base one directory up would read straight back out of it.
   */
  root?: string;
}

/**
 * Reads a profile from disk with its `extends` chain resolved.
 *
 * A reference is a path relative to the file that names it, which is what
 * someone editing two files side by side expects, and it keeps the meaning of
 * a reference discoverable from the file itself rather than from a registry
 * defined elsewhere.
 */
export async function loadMachineProfile(
  profilePath: string,
  options: LoadMachineProfileOptions = {},
): Promise<MachineProfile> {
  const resolvedPath = path.resolve(profilePath);
  const parsed = JSON.parse(await readFile(resolvedPath, 'utf-8')) as unknown;
  const profile = parseMachineProfile(parsed, resolvedPath);
  if (profile.extends === undefined) return profile;

  return resolveMachineProfileChain(
    profile,
    createFileResolver(resolvedPath, profile, options.root),
  );
}

/**
 * Resolves references as paths, relative to the file that wrote them.
 *
 * Directories are tracked per profile identity rather than by remembering the
 * last file opened, so the resolver does not depend on the order the chain
 * walker happens to call it in.
 */
function createFileResolver(
  startPath: string,
  startProfile: MachineProfile,
  root: string | undefined,
): MachineProfileResolver {
  const directories = new Map<string, string>([
    [startProfile.id, path.dirname(startPath)],
  ]);
  const boundary = root === undefined ? undefined : path.resolve(root);
  // Two references that differ as text can reach the same file, so the cycle
  // guard here is the absolute path rather than what was written.
  const visited = new Set<string>([startPath]);

  return async (reference, from) => {
    const directory = directories.get(from.id) ?? path.dirname(startPath);
    const basePath = path.resolve(directory, reference);

    if (boundary !== undefined && !isInside(boundary, basePath)) {
      throw new Error(
        `Machine profile ${from.id} extends '${reference}', which is outside ${boundary}.`,
      );
    }
    if (visited.has(basePath)) {
      throw new Error(
        `Machine profile ${from.id} has a circular extends chain through ${basePath}.`,
      );
    }
    if (!existsSync(basePath)) return undefined;

    const parsed = JSON.parse(await readFile(basePath, 'utf-8')) as unknown;
    const base = parseMachineProfile(parsed, basePath);
    visited.add(basePath);
    directories.set(base.id, path.dirname(basePath));
    return base;
  };
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
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
    extends: optionalString(value.extends, source, 'extends'),
    dialect: optionalString(value.dialect, source, 'dialect'),
    features: parseMachineFeatures(value.features, source),
    home: parseHome(value.home, source, 'home'),
    returnHome: parseHome(value.returnHome, source, 'returnHome'),
  };
}

/**
 * The parts of a post a profile can be checked against.
 *
 * Structural rather than the `BuiltInPost` type itself, so this module stays
 * free of the post registry — which imports posts, which import this module.
 * A custom post module supplies none of it and is simply not checked; a post
 * written outside the built-in set can target whatever it likes.
 */
export interface MachineProfilePostBinding {
  id: string;
  controller?: string;
  dialects?: readonly string[];
  /** VMIDs each dialect is known to serve, keyed by dialect id. */
  dialectVmids?: Readonly<Record<string, readonly string[]>>;
}

export interface MachineProfileValidationOptions {
  vmid?: VmidDefinition;
  post?: MachineProfilePostBinding;
}

/**
 * Checks a profile against everything that can independently confirm it.
 *
 * A profile is a set of claims about a machine. The trace, the VMID and the
 * post each know some of the same facts from a different direction, and a
 * disagreement means one of them is about a different machine — which is the
 * failure that produces a plausible file for the wrong control.
 */
export function validateMachineProfileCompatibility(
  profile: MachineProfile | undefined,
  events: EventData[],
  options: MachineProfileValidationOptions = {},
): VmidValidationIssue[] {
  if (!profile) return [];

  const { vmid, post } = options;
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

  issues.push(...spindleSpeedIssues(profile, events));
  issues.push(...postBindingIssues(profile, post));
  issues.push(...dialectVmidIssues(profile, events, post));
  issues.push(...homeReachIssues(profile, vmid));

  return issues;
}

/**
 * Flags a profile bound to a post that cannot serve it.
 *
 * Both halves are refusals, not warnings. A controller mismatch means the
 * G-code is being written in the wrong language entirely, and a dialect the
 * post does not define would otherwise surface as an exception thrown from
 * deep inside post registration rather than as a profile problem.
 */
function postBindingIssues(
  profile: MachineProfile,
  post: MachineProfilePostBinding | undefined,
): VmidValidationIssue[] {
  if (!post) return [];

  const issues: VmidValidationIssue[] = [];

  if (
    profile.controller !== undefined &&
    post.controller !== undefined &&
    profile.controller !== post.controller
  ) {
    issues.push({
      severity: 'error',
      key: 'controller',
      message: `Machine profile ${profile.id} is for a ${profile.controller} control, but post ${post.id} emits for ${post.controller}.`,
    });
  }

  if (
    profile.dialect !== undefined &&
    post.dialects !== undefined &&
    !post.dialects.includes(profile.dialect)
  ) {
    issues.push({
      severity: 'error',
      key: 'dialect',
      message: `Machine profile ${profile.id} names dialect '${profile.dialect}', which post ${post.id} does not define. Available dialects: ${post.dialects.join(', ')}.`,
    });
  }

  return issues;
}

/**
 * Flags a park position the machine cannot physically reach.
 *
 * Home and return-home are coordinates the post emits unconditionally at the
 * start and end of every program, so one outside the VMID's travel limits is
 * a crash on the first and last move of every job the machine ever runs.
 * Both sides already declare the numbers; nothing has to be inferred.
 */
function homeReachIssues(
  profile: MachineProfile,
  vmid: VmidDefinition | undefined,
): VmidValidationIssue[] {
  if (!vmid) return [];

  const issues: VmidValidationIssue[] = [];
  const positions = [
    { key: 'home', position: profile.home },
    { key: 'returnHome', position: profile.returnHome },
  ] as const;

  for (const { key, position } of positions) {
    if (!position) continue;

    for (const axis of vmid.axes) {
      const coordinate = position[axisCoordinate(axis.name)];
      if (coordinate === undefined) continue;
      if (axis.min === undefined || axis.max === undefined) continue;
      if (coordinate >= axis.min && coordinate <= axis.max) continue;

      issues.push({
        severity: 'error',
        key: `${key}.${axis.name.toLowerCase()}`,
        message: `Machine profile ${profile.id} puts ${key} ${axis.name} at ${coordinate}, outside the VMID travel limits ${axis.min} to ${axis.max}.`,
      });
    }
  }

  return issues;
}

function axisCoordinate(name: string): 'x' | 'y' | 'z' {
  // Anything that is not a linear axis yields a key `home` never defines, so
  // rotary axes are skipped without a special case.
  return name.toLowerCase() as 'x' | 'y' | 'z';
}

/**
 * Flags a program that commands more spindle speed than the machine has.
 *
 * `spin` is the field the post turns into an `S` word, so it is the number
 * that actually reaches the control. Catching it here means a 20000 rpm
 * program aimed at an 8000 rpm spindle is refused before anyone loads it,
 * which is the difference between a diagnostic and a crash.
 *
 * Reported as one issue naming the highest speed found, not one per event: a
 * program over the limit is usually over it thousands of times, and a
 * thousand identical errors buries every other diagnostic.
 */
function spindleSpeedIssues(
  profile: MachineProfile,
  events: EventData[],
): VmidValidationIssue[] {
  const limit = profile.features?.maxSpindleSpeed;
  if (limit === undefined) return [];

  let fastest = 0;
  let event: string | undefined;
  for (const candidate of events) {
    const spin = candidate.spin;
    if (typeof spin === 'number' && spin > fastest) {
      fastest = spin;
      event = String(candidate._eventName);
    }
  }

  if (fastest <= limit) return [];

  return [
    {
      severity: 'error',
      event,
      key: 'spin',
      message: `Machine profile ${profile.id} allows ${limit} rpm, but the program commands up to ${Math.round(fastest)} rpm.`,
    },
  ];
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

/**
 * Resolves one profile reference to the profile it names.
 *
 * Returning `undefined` means "no such base", which the chain walker turns
 * into an error naming both ends. `from` is the id of the profile doing the
 * extending, so a resolver can scope its search and so messages can say who
 * asked.
 */
export type MachineProfileResolver = (
  reference: string,
  from: MachineProfile,
) => Promise<MachineProfile | undefined> | MachineProfile | undefined;

/**
 * A profile inherits at most this many levels.
 *
 * Cycles are detected exactly, so this is not the cycle guard; it is a limit
 * on chains that are technically finite but past the point where anyone can
 * still say what a machine's settings are by reading them.
 */
const MAX_PROFILE_DEPTH = 8;

/**
 * Layers `derived` over `base`.
 *
 * Merging is per-section and one level deep: a `features` key the derived
 * profile does not mention keeps the base's value, and `home.z` survives a
 * derived profile that only moves `home.x`. Anything deeper would make the
 * result hard to predict from reading the two files.
 *
 * `id` is never inherited. Two machines sharing an id is precisely the
 * confusion profiles exist to prevent, so the derived profile keeps its own.
 * `extends` is consumed rather than carried forward: the result is flat by
 * definition, and a leftover reference would invite a second resolution pass
 * over something already resolved.
 */
export function mergeMachineProfiles(
  base: MachineProfile,
  derived: MachineProfile,
): MachineProfile {
  return {
    id: derived.id,
    name: derived.name ?? base.name,
    controller: derived.controller ?? base.controller,
    axes: derived.axes ?? base.axes,
    dialect: derived.dialect ?? base.dialect,
    features: mergeSection(base.features, derived.features),
    home: mergeSection(base.home, derived.home),
    returnHome: mergeSection(base.returnHome, derived.returnHome),
  };
}

/**
 * Walks a profile's `extends` chain and flattens it.
 *
 * Bases are applied furthest-ancestor first, so a nearer profile always wins.
 * A profile with no `extends` is returned unchanged, which makes calling this
 * unconditionally safe.
 */
export async function resolveMachineProfileChain(
  profile: MachineProfile,
  resolve: MachineProfileResolver,
): Promise<MachineProfile> {
  const chain: MachineProfile[] = [profile];
  const seen = new Set<string>();
  let current = profile;

  while (current.extends !== undefined) {
    if (chain.length > MAX_PROFILE_DEPTH) {
      throw new Error(
        `Machine profile ${profile.id} extends more than ${MAX_PROFILE_DEPTH} levels deep. Flatten the chain.`,
      );
    }

    const reference = current.extends;
    // Guard on the reference as written. Resolved profile ids are not usable
    // here: two machines legitimately share one, and treating that as a cycle
    // would reject the very case this feature exists for — a machine that
    // extends a sibling built from the same base. A resolver whose references
    // can alias (a filesystem, where two paths reach one file) canonicalizes
    // them itself.
    if (seen.has(reference)) {
      throw new Error(
        `Machine profile ${profile.id} has a circular extends chain through '${reference}'.`,
      );
    }
    seen.add(reference);

    const base = await resolve(reference, current);
    if (!base) {
      throw new Error(
        `Machine profile ${current.id} extends '${reference}', which could not be found.`,
      );
    }
    chain.push(base);
    current = base;
  }

  // Furthest ancestor first, each layer overriding the one before it.
  return chain
    .reverse()
    .reduce((merged, next) => mergeMachineProfiles(merged, next));
}

function mergeSection<T extends object>(
  base: T | undefined,
  derived: T | undefined,
): T | undefined {
  if (base === undefined) return derived;
  if (derived === undefined) return base;

  const merged = { ...base };
  for (const [key, value] of Object.entries(derived)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/**
 * Flags a profile whose dialect belongs to a different machine than the one
 * the trace was posted for.
 *
 * A dialect is an output convention and a VMID is a machine, so the two are
 * not the same fact — but a shop posts a given machine through one GPP, and
 * the post advertises which pairings it has seen. Getting this wrong produces
 * a file that is subtly wrong everywhere rather than one that fails: a job
 * posted under the wrong dialect came back missing its start-position blocks
 * with every block number shifted, and nothing objected.
 *
 * Silent unless the trace's VMID is one the post positively assigns to
 * another dialect. An unrecognised VMID is a machine nobody has recorded yet,
 * not a mismatch.
 */
function dialectVmidIssues(
  profile: MachineProfile,
  events: EventData[],
  post: MachineProfilePostBinding | undefined,
): VmidValidationIssue[] {
  const table = post?.dialectVmids;
  const dialect = profile.dialect;
  if (!table || dialect === undefined) return [];

  const declared = events.find(
    (event) => event._eventName === 'StartOfFile',
  )?.VMID_file;
  if (typeof declared !== 'string' || declared.length === 0) return [];

  const normalized = normalizeVmidName(declared);
  const owner = Object.entries(table).find(([, vmids]) =>
    vmids.some((name) => normalizeVmidName(name) === normalized),
  )?.[0];

  if (owner === undefined || owner === dialect) return [];

  return [
    {
      severity: 'error',
      event: 'StartOfFile',
      key: 'VMID_file',
      message: `Machine profile ${profile.id} names dialect '${dialect}', but the trace was posted for VMID ${declared}, which belongs to dialect '${owner}'.`,
    },
  ];
}

/** Drops a file extension and case, matching how `vmid.ts` compares names. */
function normalizeVmidName(value: string): string {
  return value.replace(/\.[^.]+$/, '').toLowerCase();
}

function traceAxisCount(events: EventData[]): number | undefined {
  const startOfFile = events.find(
    (event) => event._eventName === 'StartOfFile',
  );
  const value = startOfFile?.iNumberOfAixs;
  return typeof value === 'number' ? value : undefined;
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
