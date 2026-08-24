import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  parseMachineProfile,
  parseVmid,
  resolveBuiltinPost,
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

  if (draft.vmid !== undefined) {
    let parsed: ReturnType<typeof parseVmid>;
    try {
      parsed = parseVmid(draft.vmid);
    } catch (error) {
      throw badRequest(`The VMID could not be parsed: ${messageOf(error)}`);
    }
    // `parseVmid` is deliberately lenient — arbitrary text yields an empty
    // definition rather than an error. Accepting that would store a file that
    // validates nothing and silently weakens every job posted against this
    // machine, so an empty result is treated as the wrong file.
    if (parsed.axes.length === 0 && parsed.parameters.length === 0) {
      throw badRequest(
        "That file contains no VMID axes or parameters. Check that it is the machine's .vmid file.",
      );
    }
  }

  if (draft.machineProfile !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft.machineProfile);
    } catch {
      throw badRequest('The machine profile is not valid JSON.');
    }
    try {
      parseMachineProfile(parsed, 'machineProfile');
    } catch (error) {
      throw badRequest(messageOf(error));
    }
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
  if (patch.machineProfile !== undefined) {
    assertMachineProfile(patch.machineProfile);
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
    machineProfile: machine.profileFile
      ? await Bun.file(path.join(directory, machine.profileFile)).text()
      : undefined,
  };
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

function assertMachineProfile(source: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw badRequest('The machine profile is not valid JSON.');
  }
  try {
    parseMachineProfile(parsed, 'machineProfile');
  } catch (error) {
    throw badRequest(messageOf(error));
  }
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
