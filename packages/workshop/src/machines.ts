import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  type MachineProfile,
  type MachineProfileResolver,
  parseMachineProfile,
  parseVmid,
  resolveBuiltinPost,
  resolveMachineProfileChain,
  type VmidDefinition,
  validateMachineProfileCompatibility,
} from '@achar/core';
import { badRequest, messageOf } from '@achar/server';
import type { DataPaths } from './data/paths';
import type { JobStore, MachineRecord } from './data/store';

/**
 * Centrally-owned machine configuration.
 *
 * This is the mechanism behind "same trace, same G-code". A VMID and a machine
 * profile sitting on individual desktops drift apart silently, and two people
 * posting the same job get different output with nothing to point at. Here
 * there is exactly one copy of each, the operator picks a machine by name, and
 * the configuration cannot vary by who ran it.
 *
 * Files live beside the database on the volume; the row records which files a
 * machine has. Both companion documents are optional — a post with neither is
 * still a valid machine, it simply gets no VMID or profile validation.
 */

export interface MachineSummary {
  id: string;
  name: string;
  postId: string;
  postName: string;
  hasVmid: boolean;
  hasProfile: boolean;
}

export interface MachineDraft {
  name: string;
  postId: string;
  vmid?: string;
  machineProfile?: string;
}

/**
 * A partial change to a machine. An absent field is left as it is; a present
 * `clear*` flag removes the corresponding document.
 */
export interface MachinePatch {
  name?: string;
  postId?: string;
  vmid?: string;
  machineProfile?: string;
  clearVmid?: boolean;
  clearProfile?: boolean;
}

/** Documents a job needs, read back off the volume. */
export interface MachineDocuments {
  postId: string;
  vmid?: string;
  machineProfile?: string;
}

const VMID_FILENAME = 'machine.vmid';
const PROFILE_FILENAME = 'machine.json';

export function machineDirectory(paths: DataPaths, id: string): string {
  return path.join(paths.machines, id);
}

export function summarizeMachine(machine: MachineRecord): MachineSummary {
  const post = resolveBuiltinPost(machine.postId);
  return {
    id: machine.id,
    name: machine.name,
    postId: machine.postId,
    postName: post?.name ?? machine.postId,
    hasVmid: machine.vmidFile !== null,
    hasProfile: machine.profileFile !== null,
  };
}

/**
 * Validates a draft and writes it to the volume.
 *
 * Both documents are parsed here, at the point of definition, rather than on
 * first use. A machine that cannot be posted with should fail while an admin
 * is looking at the form, not eight hours later when a machinist uploads a
 * trace against it.
 */
export async function createMachine(
  store: JobStore,
  paths: DataPaths,
  draft: MachineDraft,
): Promise<MachineSummary> {
  const name = draft.name.trim();
  if (!name) throw badRequest('A machine name is required.');

  if (!resolveBuiltinPost(draft.postId)) {
    throw badRequest(
      `Unknown post '${draft.postId}'. Call GET /v1/posts for the available ids.`,
    );
  }

  if (draft.vmid !== undefined) assertVmid(draft.vmid);

  if (draft.machineProfile !== undefined) {
    await assertMachineProfile(store, paths, draft.machineProfile, {
      postId: draft.postId,
      vmid: draft.vmid === undefined ? undefined : parseVmid(draft.vmid),
    });
  }

  const id = uniqueId(store, slugify(name));
  const directory = machineDirectory(paths, id);
  await mkdir(directory, { recursive: true });

  if (draft.vmid !== undefined) {
    await Bun.write(path.join(directory, VMID_FILENAME), draft.vmid);
  }
  if (draft.machineProfile !== undefined) {
    await Bun.write(
      path.join(directory, PROFILE_FILENAME),
      draft.machineProfile,
    );
  }

  const record: MachineRecord = {
    id,
    name,
    postId: draft.postId,
    vmidFile: draft.vmid === undefined ? null : VMID_FILENAME,
    profileFile: draft.machineProfile === undefined ? null : PROFILE_FILENAME,
    createdAt: Date.now(),
  };
  store.upsertMachine(record);
  return summarizeMachine(record);
}

/**
 * Applies a partial change to an existing machine.
 *
 * Only the fields present in the patch move. A companion document is replaced
 * when supplied and removed when explicitly cleared, because "leave it alone"
 * and "delete it" are different intentions and an absent field cannot mean
 * both.
 */
export async function updateMachine(
  store: JobStore,
  paths: DataPaths,
  id: string,
  patch: MachinePatch,
): Promise<MachineSummary> {
  const existing = store.findMachine(id);
  if (!existing) throw badRequest(`Unknown machine '${id}'.`);

  const name = patch.name === undefined ? existing.name : patch.name.trim();
  if (!name) throw badRequest('A machine name is required.');

  const postId = patch.postId ?? existing.postId;
  if (!resolveBuiltinPost(postId)) {
    throw badRequest(
      `Unknown post '${postId}'. Call GET /v1/posts for the available ids.`,
    );
  }

  if (patch.vmid !== undefined) assertVmid(patch.vmid);

  // The profile is checked against whichever VMID the machine will have once
  // this patch lands, not the one it had: a new VMID with tighter travel can
  // put an untouched home position out of reach.
  const effectiveVmid = await resolveEffectiveVmid(paths, existing, patch);

  if (patch.machineProfile !== undefined) {
    await assertMachineProfile(store, paths, patch.machineProfile, {
      postId,
      selfId: id,
      vmid: effectiveVmid,
    });
  } else if (
    (postId !== existing.postId || patch.vmid !== undefined) &&
    existing.profileFile
  ) {
    // Changing the post or the VMID can invalidate a profile nobody touched:
    // dialects belong to one post, and travel limits belong to one VMID.
    // Re-check what is already on disk rather than discovering it on the next
    // upload.
    const stored = await Bun.file(
      path.join(machineDirectory(paths, id), existing.profileFile),
    ).text();
    await assertMachineProfile(store, paths, stored, {
      postId,
      selfId: id,
      vmid: effectiveVmid,
    });
  }

  const directory = machineDirectory(paths, id);
  await mkdir(directory, { recursive: true });

  const vmidFile = await applyDocument(
    directory,
    VMID_FILENAME,
    existing.vmidFile,
    patch.vmid,
    patch.clearVmid,
  );
  const profileFile = await applyDocument(
    directory,
    PROFILE_FILENAME,
    existing.profileFile,
    patch.machineProfile,
    patch.clearProfile,
  );

  const record: MachineRecord = {
    ...existing,
    name,
    postId,
    vmidFile,
    profileFile,
  };
  store.upsertMachine(record);
  return summarizeMachine(record);
}

/** Writes, removes, or leaves one companion document, returning its filename. */
async function applyDocument(
  directory: string,
  filename: string,
  current: string | null,
  replacement: string | undefined,
  clear: boolean | undefined,
): Promise<string | null> {
  if (replacement !== undefined) {
    await Bun.write(path.join(directory, filename), replacement);
    return filename;
  }
  if (clear) {
    await rm(path.join(directory, filename), { force: true });
    return null;
  }
  return current;
}

export async function deleteMachine(
  store: JobStore,
  paths: DataPaths,
  id: string,
): Promise<void> {
  if (!store.findMachine(id)) throw badRequest(`Unknown machine '${id}'.`);

  // Deleting a base would leave its dependants unpostable, and they would not
  // find out until someone uploaded a trace against one. Refusing here puts
  // the choice in front of the person who can still make it.
  const dependents = await dependentMachines(store, paths, id);
  if (dependents.length > 0) {
    throw badRequest(
      `This machine is the base for ${dependents.join(', ')}. Point them at another base, or delete them first.`,
    );
  }

  store.deleteMachine(id);
  // Jobs keep their machine_id after the machine is gone, so history still
  // records what a program was posted for even once the machine is retired.
  await rm(machineDirectory(paths, id), { recursive: true, force: true });
}

/** Reads a machine's documents back for a job. */
export async function loadMachineDocuments(
  store: JobStore,
  paths: DataPaths,
  id: string,
): Promise<MachineDocuments> {
  const machine = store.findMachine(id);
  if (!machine) throw badRequest(`Unknown machine '${id}'.`);

  const directory = machineDirectory(paths, id);
  return {
    postId: machine.postId,
    vmid: machine.vmidFile
      ? await Bun.file(path.join(directory, machine.vmidFile)).text()
      : undefined,
    // Flattened before it leaves: the profile crosses into a worker process
    // that has no way to reach the other machines, so `extends` is resolved
    // on this side and what travels is one self-contained document.
    machineProfile: await loadResolvedProfile(store, paths, id),
  };
}

async function loadResolvedProfile(
  store: JobStore,
  paths: DataPaths,
  id: string,
): Promise<string | undefined> {
  const profile = await readStoredProfile(store, paths, id);
  if (!profile) return undefined;
  if (profile.extends === undefined) return JSON.stringify(profile);

  return JSON.stringify(
    await resolveMachineProfileChain(profile, machineResolver(store, paths)),
  );
}

/**
 * Rejects anything that is not really a VMID.
 *
 * `parseVmid` is deliberately lenient — arbitrary text yields an empty
 * definition rather than an error. Storing that would give the machine a file
 * that validates nothing and silently weaken every job posted against it, so
 * an empty result is treated as the wrong file.
 */
function assertVmid(source: string): void {
  let parsed: ReturnType<typeof parseVmid>;
  try {
    parsed = parseVmid(source);
  } catch (error) {
    throw badRequest(`The VMID could not be parsed: ${messageOf(error)}`);
  }
  if (parsed.axes.length === 0 && parsed.parameters.length === 0) {
    throw badRequest(
      "That file contains no VMID axes or parameters. Check that it is the machine's .vmid file.",
    );
  }
}

/**
 * Reads one machine's stored profile, unresolved.
 *
 * Returns undefined when the machine has no profile, which the chain walker
 * reports as an unfound base.
 */
async function readStoredProfile(
  store: JobStore,
  paths: DataPaths,
  machineId: string,
): Promise<MachineProfile | undefined> {
  const machine = store.findMachine(machineId);
  if (!machine?.profileFile) return undefined;

  const source = await Bun.file(
    path.join(machineDirectory(paths, machineId), machine.profileFile),
  ).text();
  return parseMachineProfile(JSON.parse(source), `machine ${machineId}`);
}

/**
 * Resolves `extends` as another machine's id.
 *
 * A workshop's shared configuration already has names: the machines
 * themselves. "Like the PoyaKar but four-axis" is the sentence an admin would
 * say, and making it the literal content of the profile means the shared
 * values have exactly one home, the one everybody already edits.
 */
function machineResolver(
  store: JobStore,
  paths: DataPaths,
): MachineProfileResolver {
  return (reference) => readStoredProfile(store, paths, reference);
}

interface ProfileCheck {
  postId: string;
  /** The machine being edited, when there is one — it cannot extend itself. */
  selfId?: string;
  /** The VMID the machine will have, when it has one. */
  vmid?: VmidDefinition;
}

/** The VMID a machine will hold once a patch is applied. */
async function resolveEffectiveVmid(
  paths: DataPaths,
  existing: MachineRecord,
  patch: MachinePatch,
): Promise<VmidDefinition | undefined> {
  if (patch.vmid !== undefined) return parseVmid(patch.vmid);
  if (patch.clearVmid || !existing.vmidFile) return undefined;

  return parseVmid(
    await Bun.file(
      path.join(machineDirectory(paths, existing.id), existing.vmidFile),
    ).text(),
  );
}

/**
 * Rejects a profile the given post cannot honour, or whose base is unusable.
 *
 * The dialect check needs the post, which is why this takes one: a dialect id
 * is meaningful only to the post that defines it, and a machine bound to a
 * post that has never heard of its dialect would otherwise fail at post time,
 * on a machinist's upload, instead of here on an admin's form.
 *
 * The chain is walked rather than merely inspected, so a missing base or a
 * cycle is caught at the same moment, on the same form.
 */
async function assertMachineProfile(
  store: JobStore,
  paths: DataPaths,
  source: string,
  check: ProfileCheck,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw badRequest('The machine profile is not valid JSON.');
  }

  let profile: MachineProfile;
  try {
    profile = parseMachineProfile(parsed, 'machineProfile');
  } catch (error) {
    throw badRequest(messageOf(error));
  }

  if (profile.extends !== undefined) {
    if (profile.extends === check.selfId) {
      throw badRequest('A machine cannot extend itself.');
    }
    if (!store.findMachine(profile.extends)) {
      throw badRequest(
        `This profile extends machine '${profile.extends}', which does not exist.`,
      );
    }
    try {
      profile = await resolveMachineProfileChain(
        profile,
        machineResolver(store, paths),
      );
    } catch (error) {
      throw badRequest(messageOf(error));
    }
  }

  // Checked against the resolved profile, and through the same function the
  // posting path uses. An inherited dialect or an inherited home position is
  // exactly as capable of being wrong as one written here, and a check that
  // only lived in this file would drift from the one that actually gates
  // generation.
  const issues = validateMachineProfileCompatibility(profile, [], {
    vmid: check.vmid,
    post: resolveBuiltinPost(check.postId),
  });
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw badRequest(errors.map((issue) => issue.message).join(' '));
  }
}

/**
 * Machines whose profile extends the given one, by id.
 *
 * Used to refuse a delete that would leave a profile pointing at nothing.
 */
async function dependentMachines(
  store: JobStore,
  paths: DataPaths,
  machineId: string,
): Promise<string[]> {
  const dependents: string[] = [];

  for (const machine of store.listMachines()) {
    if (machine.id === machineId) continue;
    const profile = await readStoredProfile(store, paths, machine.id);
    if (profile?.extends === machineId) dependents.push(machine.name);
  }

  return dependents;
}

/**
 * A filesystem- and URL-safe id derived from the machine's name.
 *
 * Only Latin letters and digits survive, so a Persian name — which most of
 * these will be — leaves little or nothing behind. A remnant of one or two
 * characters is worse than no remnant at all: "پویاکار ۱۱۶۰L سه محور" would
 * become the id `l`, which tells a later reader nothing and collides with the
 * next name that happens to contain an L. Below the threshold the id becomes
 * a numbered `machine`, which is at least honest about being opaque.
 */
const MIN_MEANINGFUL_SLUG = 3;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.replace(/-/g, '').length >= MIN_MEANINGFUL_SLUG
    ? slug
    : 'machine';
}

function uniqueId(store: JobStore, base: string): string {
  if (!store.findMachine(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!store.findMachine(candidate)) return candidate;
  }
  return `${base}-${Bun.randomUUIDv7().slice(0, 8)}`;
}
