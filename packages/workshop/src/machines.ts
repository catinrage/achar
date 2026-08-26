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
import type { JobStore, MachineDefinition, MachineRecord } from './data/store';

/**
 * Centrally-owned machine configuration.
 *
 * This is the mechanism behind "same trace, same G-code". A VMID and a machine
 * profile sitting on individual desktops drift apart silently, and two people
 * posting the same job get different output with nothing to point at. Here
 * there is exactly one copy of each, the operator picks a machine by name, and
 * the configuration cannot vary by who ran it.
 *
 * A machine is a record, not a folder of files. Its profile is a column, built
 * field by field through the workshop form and normalized here; only the VMID
 * is still a file, because a `.vmid` is an artefact the machine builder
 * produced and nobody authors one by hand. That split is the whole storage
 * rule: what this application owns lives in the database, what it merely
 * received lives on the volume.
 */

export interface MachineSummary {
  id: string;
  name: string;
  postId: string;
  postName: string;
  hasVmid: boolean;
  hasProfile: boolean;
  /**
   * The stored profile, as the form needs it back.
   *
   * Returned in full rather than as a `hasProfile` flag, because editing a
   * machine means editing these values, and a form that cannot read the
   * current ones can only offer to replace them wholesale — which is the
   * file-upload interface this replaced.
   */
  profile: MachineProfile | null;
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

/** Documents a job needs, read back off the volume and the database. */
export interface MachineDocuments {
  postId: string;
  vmid?: string;
  machineProfile?: string;
}

const VMID_FILENAME = 'machine.vmid';

export function machineDirectory(paths: DataPaths, id: string): string {
  return path.join(paths.machines, id);
}

export function summarizeMachine(machine: MachineDefinition): MachineSummary {
  const post = resolveBuiltinPost(machine.postId);
  return {
    id: machine.id,
    name: machine.name,
    postId: machine.postId,
    postName: post?.name ?? machine.postId,
    hasVmid: machine.vmidFile !== null,
    hasProfile: machine.profile !== null,
    profile: readProfileColumn(machine),
  };
}

/**
 * Validates a draft and stores it.
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

  const id = uniqueId(store, slugify(name));
  const profile =
    draft.machineProfile === undefined
      ? null
      : await validatedProfile(store, draft.machineProfile, {
          postId: draft.postId,
          selfId: id,
          identity: { id, name },
          vmid: draft.vmid === undefined ? undefined : parseVmid(draft.vmid),
        });

  if (draft.vmid !== undefined) {
    const directory = machineDirectory(paths, id);
    await mkdir(directory, { recursive: true });
    await Bun.write(path.join(directory, VMID_FILENAME), draft.vmid);
  }

  const record: MachineDefinition = {
    id,
    name,
    postId: draft.postId,
    vmidFile: draft.vmid === undefined ? null : VMID_FILENAME,
    profile,
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
  const check = {
    postId,
    selfId: id,
    identity: { id, name },
    vmid: effectiveVmid,
  };

  let profile = existing.profile;
  if (patch.machineProfile !== undefined) {
    profile = await validatedProfile(store, patch.machineProfile, check);
  } else if (patch.clearProfile) {
    profile = null;
  } else if (
    existing.profile &&
    (postId !== existing.postId ||
      patch.vmid !== undefined ||
      patch.clearVmid === true ||
      name !== existing.name)
  ) {
    // Changing the post or the VMID can invalidate a profile nobody touched:
    // dialects belong to one post, and travel limits belong to one VMID.
    // Re-check what is already stored rather than discovering it on the next
    // upload. A rename passes through here too, so the profile's own `name`
    // never drifts from the machine's.
    profile = await validatedProfile(store, existing.profile, check);
  }

  const vmidFile = await applyVmid(
    machineDirectory(paths, id),
    existing.vmidFile,
    patch.vmid,
    patch.clearVmid,
  );

  const record: MachineDefinition = {
    ...existing,
    name,
    postId,
    vmidFile,
    profile,
  };
  store.upsertMachine(record);
  return summarizeMachine(record);
}

/** Writes, removes, or leaves the VMID file, returning its filename. */
async function applyVmid(
  directory: string,
  current: string | null,
  replacement: string | undefined,
  clear: boolean | undefined,
): Promise<string | null> {
  if (replacement !== undefined) {
    await mkdir(directory, { recursive: true });
    await Bun.write(path.join(directory, VMID_FILENAME), replacement);
    return VMID_FILENAME;
  }
  if (clear) {
    await rm(path.join(directory, VMID_FILENAME), { force: true });
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
  const dependents = dependentMachines(store, id);
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
    machineProfile: await loadResolvedProfile(store, id),
  };
}

async function loadResolvedProfile(
  store: JobStore,
  id: string,
): Promise<string | undefined> {
  const profile = readStoredProfile(store, id);
  if (!profile) return undefined;
  if (profile.extends === undefined) return JSON.stringify(profile);

  return JSON.stringify(
    await resolveMachineProfileChain(profile, machineResolver(store)),
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

/** One machine's stored profile, unresolved, or undefined when it has none. */
function readStoredProfile(
  store: JobStore,
  machineId: string,
): MachineProfile | undefined {
  const machine = store.findMachine(machineId);
  return machine ? (readProfileColumn(machine) ?? undefined) : undefined;
}

/**
 * Parses a profile column.
 *
 * Everything in the column was validated before it was written, so a failure
 * here means the row was edited outside the application. Reporting null rather
 * than throwing keeps one bad row from taking down the machine list, and the
 * form will show the machine as having no profile — which is visible, and
 * fixable, in a way an exception on page load is not.
 */
function readProfileColumn(machine: MachineDefinition): MachineProfile | null {
  if (machine.profile === null) return null;
  try {
    return parseMachineProfile(
      JSON.parse(machine.profile),
      `machine ${machine.id}`,
    );
  } catch (error) {
    console.error(
      `[achar] machine ${machine.id} has an unreadable profile: ${messageOf(error)}`,
    );
    return null;
  }
}

/**
 * Resolves `extends` as another machine's id.
 *
 * A workshop's shared configuration already has names: the machines
 * themselves. "Like the PoyaKar but four-axis" is the sentence an admin would
 * say, and making it the literal content of the profile means the shared
 * values have exactly one home, the one everybody already edits.
 */
function machineResolver(store: JobStore): MachineProfileResolver {
  return (reference) => readStoredProfile(store, reference);
}

interface ProfileCheck {
  postId: string;
  /** The machine being edited, when there is one — it cannot extend itself. */
  selfId?: string;
  /** The id and name the profile must carry. */
  identity: { id: string; name: string };
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
 * Validates a profile and returns the exact JSON to store, or null when the
 * profile says nothing worth keeping.
 *
 * The identity is imposed rather than accepted. A machine's row already has an
 * id and a name, and letting the document carry a second pair invites the two
 * to disagree — which matters, because `extends` names machines by id and a
 * profile whose id is someone else's machine is a trap nobody would see. A
 * form has no business asking for either.
 *
 * The rest is checked exactly as an uploaded profile was: parsed, its chain
 * walked, and run through the same compatibility function that gates
 * generation, so the form and the posting path cannot drift.
 */
async function validatedProfile(
  store: JobStore,
  source: string,
  check: ProfileCheck,
): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw badRequest('The machine profile is not valid JSON.');
  }

  let profile: MachineProfile;
  try {
    profile = parseMachineProfile(
      { ...(parsed as object), id: check.identity.id },
      'machineProfile',
    );
  } catch (error) {
    throw badRequest(messageOf(error));
  }

  profile = { ...profile, name: check.identity.name };
  if (!describesAnything(profile)) return null;

  let resolved = profile;
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
      resolved = await resolveMachineProfileChain(
        profile,
        machineResolver(store),
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
  const issues = validateMachineProfileCompatibility(resolved, [], {
    vmid: check.vmid,
    post: resolveBuiltinPost(check.postId),
  });
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw badRequest(errors.map((issue) => issue.message).join(' '));
  }

  return JSON.stringify(profile);
}

/**
 * True when a profile states something the post could act on.
 *
 * Every machine has an id and a name whether it has a profile or not, so a
 * document carrying only those two is an empty form, not a configuration.
 * Storing it would make the machine list claim a profile that changes no
 * output.
 */
function describesAnything(profile: MachineProfile): boolean {
  return (
    profile.controller !== undefined ||
    profile.axes !== undefined ||
    profile.extends !== undefined ||
    profile.dialect !== undefined ||
    Object.keys(profile.features ?? {}).length > 0 ||
    hasCoordinate(profile.home) ||
    hasCoordinate(profile.returnHome)
  );
}

function hasCoordinate(
  position: { x?: number; y?: number; z?: number } | undefined,
): boolean {
  if (!position) return false;
  return (
    position.x !== undefined ||
    position.y !== undefined ||
    position.z !== undefined
  );
}

/**
 * Machines whose profile extends the given one, by id.
 *
 * Used to refuse a delete that would leave a profile pointing at nothing.
 */
function dependentMachines(store: JobStore, machineId: string): string[] {
  const dependents: string[] = [];

  for (const machine of store.listMachines()) {
    if (machine.id === machineId) continue;
    if (readProfileColumn(machine)?.extends === machineId) {
      dependents.push(machine.name);
    }
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
