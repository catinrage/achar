import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '@achar/server';
import type { DataPaths } from './data/paths';
import {
  legacyJobTracePath,
  prepareDataPaths,
  traceFilePath,
} from './data/paths';
import { JobStore } from './data/store';
import {
  createMachine,
  deleteMachine,
  loadMachineDocuments,
  updateMachine,
} from './machines';
import { migrateWorkshopData } from './migrate';

const FIXTURES = path.resolve(
  import.meta.dir,
  '../../../fixtures/PROJECT_567_112250296390862_CAM_Milling',
);

let paths: DataPaths;
let store: JobStore;
let root: string;

beforeEach(() => {
  root = path.join('/tmp', `achar-machines-${Bun.randomUUIDv7()}`);
  paths = prepareDataPaths(root);
  store = new JobStore(paths);
});

afterEach(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
});

const vmid = () =>
  Bun.file(path.join(FIXTURES, 'PoyaKar_1160L_3A.vmid')).text();
const profile = () =>
  Bun.file(path.join(FIXTURES, 'PoyaKar_1160L_3A.machine.json')).text();

async function expectRejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error('Expected the call to be rejected.');
}

describe('createMachine', () => {
  it('stores a machine with both companion documents', async () => {
    const machine = await createMachine(store, paths, {
      name: 'PoyaKar 1160L 3A',
      postId: 'siemens-828d',
      vmid: await vmid(),
      machineProfile: await profile(),
    });

    expect(machine.id).toBe('poyakar-1160l-3a');
    expect(machine.hasVmid).toBe(true);
    expect(machine.hasProfile).toBe(true);

    const documents = await loadMachineDocuments(store, paths, machine.id);
    expect(documents.postId).toBe('siemens-828d');
    expect(documents.vmid).toContain('Axis');
    expect(JSON.parse(documents.machineProfile ?? '{}')).toBeObject();
  });

  it('accepts a machine with no VMID or profile', async () => {
    const machine = await createMachine(store, paths, {
      name: 'Bare Machine',
      postId: 'siemens-828d',
    });

    expect(machine.hasVmid).toBe(false);
    const documents = await loadMachineDocuments(store, paths, machine.id);
    expect(documents.vmid).toBeUndefined();
    expect(documents.machineProfile).toBeUndefined();
  });

  it('rejects text that parses to an empty VMID', async () => {
    // `parseVmid` never throws on arbitrary text, so the emptiness of the
    // result is the only signal that the wrong file was uploaded.
    const error = await expectRejection(
      createMachine(store, paths, {
        name: 'Wrong File',
        postId: 'siemens-828d',
        vmid: 'not a vmid at all',
      }),
    );

    expect(error.status).toBe(400);
    expect(error.message).toContain('no VMID axes or parameters');
  });

  it('rejects an unknown post', async () => {
    const error = await expectRejection(
      createMachine(store, paths, { name: 'Nope', postId: 'fanuc-9000' }),
    );
    expect(error.message).toContain("Unknown post 'fanuc-9000'");
  });

  it('rejects a machine profile that is not JSON', async () => {
    const error = await expectRejection(
      createMachine(store, paths, {
        name: 'Broken Profile',
        postId: 'siemens-828d',
        machineProfile: '{ not json',
      }),
    );
    expect(error.message).toContain('not valid JSON');
  });

  it("rejects a dialect the machine's post cannot speak", async () => {
    const error = await expectRejection(
      createMachine(store, paths, {
        name: 'Typo Dialect',
        postId: 'siemens-828d',
        machineProfile: JSON.stringify({
          id: 'typo',
          dialect: 'poyakar-1160',
        }),
      }),
    );
    expect(error.message).toContain(
      "names dialect 'poyakar-1160', which post siemens-828d does not define",
    );
  });

  it("rejects dialect traits left in a profile's features block", async () => {
    // Accepting them would store a profile whose flags are silently ignored,
    // so the machine would post different G-code than the file describes.
    const error = await expectRejection(
      createMachine(store, paths, {
        name: 'Legacy Flags',
        postId: 'siemens-828d',
        machineProfile: JSON.stringify({
          id: 'legacy',
          features: { compactCoordinates: true },
        }),
      }),
    );
    expect(error.message).toContain('compactCoordinates');
  });

  it('rejects a profile for a different control than the post emits', async () => {
    const error = await expectRejection(
      createMachine(store, paths, {
        name: 'Wrong Control',
        postId: 'siemens-828d',
        machineProfile: JSON.stringify({
          id: 'fanuc-cell',
          controller: 'fanuc-0i',
        }),
      }),
    );
    expect(error.message).toContain(
      'is for a fanuc-0i control, but post siemens-828d emits for siemens-828d',
    );
  });

  it('rejects a home position the machine cannot reach', async () => {
    // Home is emitted at the start and end of every program, so one outside
    // the VMID envelope is a crash on every job the machine ever runs.
    const error = await expectRejection(
      createMachine(store, paths, {
        name: 'Unreachable Home',
        postId: 'siemens-828d',
        vmid: await vmid(),
        machineProfile: JSON.stringify({
          id: 'unreachable',
          home: { x: -900, y: 0, z: 0 },
        }),
      }),
    );
    expect(error.message).toContain(
      'puts home X at -900, outside the VMID travel limits -550 to 550',
    );
  });

  it('accepts a home position inside the VMID envelope', async () => {
    const machine = await createMachine(store, paths, {
      name: 'Reachable Home',
      postId: 'siemens-828d',
      vmid: await vmid(),
      machineProfile: await profile(),
    });

    expect(machine.hasProfile).toBe(true);
  });

  it('rejects a blank name', async () => {
    const error = await expectRejection(
      createMachine(store, paths, { name: '   ', postId: 'siemens-828d' }),
    );
    expect(error.message).toContain('name is required');
  });

  describe('identifiers', () => {
    it('does not derive a one-letter id from a mostly non-Latin name', async () => {
      // "پویاکار ۱۱۶۰L سه محور" leaves only the stray "L" behind, which would
      // be both meaningless and prone to colliding with the next such name.
      const machine = await createMachine(store, paths, {
        name: 'پویاکار ۱۱۶۰L سه محور',
        postId: 'siemens-828d',
      });

      expect(machine.id).toBe('machine');
      expect(machine.name).toBe('پویاکار ۱۱۶۰L سه محور');
    });

    it('numbers colliding identifiers instead of overwriting', async () => {
      const first = await createMachine(store, paths, {
        name: 'ماشین اول',
        postId: 'siemens-828d',
      });
      const second = await createMachine(store, paths, {
        name: 'ماشین دوم',
        postId: 'siemens-828d',
      });

      expect(first.id).toBe('machine');
      expect(second.id).toBe('machine-2');
      expect(store.listMachines()).toHaveLength(2);
    });
  });
});

describe('deleteMachine', () => {
  it('removes the record and its stored documents', async () => {
    const machine = await createMachine(store, paths, {
      name: 'Retired Machine',
      postId: 'siemens-828d',
      vmid: await vmid(),
    });

    await deleteMachine(store, paths, machine.id);

    expect(store.findMachine(machine.id)).toBeUndefined();
    expect(
      await Bun.file(
        path.join(paths.machines, machine.id, 'machine.vmid'),
      ).exists(),
    ).toBe(false);
  });

  it('rejects an unknown machine', async () => {
    const error = await expectRejection(deleteMachine(store, paths, 'ghost'));
    expect(error.message).toContain("Unknown machine 'ghost'");
  });
});

describe('machine profile inheritance', () => {
  const baseProfile = JSON.stringify({
    id: 'poyakar-1160l-3a',
    controller: 'siemens-828d',
    axes: 3,
    dialect: 'poyakar-1160l',
    features: { dwellAfterCoolantOn: true, tapCycleOptionalStop: true },
    home: { x: -465, y: 190, z: 0 },
  });

  const createBase = () =>
    createMachine(store, paths, {
      name: 'PoyaKar 1160L 3A',
      postId: 'siemens-828d',
      machineProfile: baseProfile,
    });

  it('lets a machine state only what differs from its base', async () => {
    const base = await createBase();
    const derived = await createMachine(store, paths, {
      name: 'PoyaKar 1160L 4A',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({
        id: 'poyakar-1160l-4a',
        extends: base.id,
        axes: 4,
      }),
    });

    const documents = await loadMachineDocuments(store, paths, derived.id);
    const profile = JSON.parse(documents.machineProfile ?? '{}');

    expect(profile.axes).toBe(4);
    expect(profile.dialect).toBe('poyakar-1160l');
    expect(profile.features).toEqual({
      dwellAfterCoolantOn: true,
      tapCycleOptionalStop: true,
    });
    expect(profile.home).toEqual({ x: -465, y: 190, z: 0 });
    // Flattened on this side: the worker process cannot reach other machines.
    expect(profile.extends).toBeUndefined();
  });

  it('rejects a base that does not exist', async () => {
    const error = await expectRejection(
      createMachine(store, paths, {
        name: 'Orphan',
        postId: 'siemens-828d',
        machineProfile: JSON.stringify({ id: 'orphan', extends: 'nope' }),
      }),
    );
    expect(error.message).toContain("machine 'nope', which does not exist");
  });

  it('rejects a machine extending itself', async () => {
    const base = await createBase();
    const error = await expectRejection(
      updateMachine(store, paths, base.id, {
        machineProfile: JSON.stringify({ id: 'self', extends: base.id }),
      }),
    );
    expect(error.message).toContain('cannot extend itself');
  });

  it('refuses to delete a machine another machine is built on', async () => {
    const base = await createBase();
    await createMachine(store, paths, {
      name: 'PoyaKar 1160L 4A',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({
        id: 'derived',
        extends: base.id,
        axes: 4,
      }),
    });

    const error = await expectRejection(deleteMachine(store, paths, base.id));
    expect(error.message).toContain('PoyaKar 1160L 4A');
    expect(store.findMachine(base.id)).toBeDefined();
  });

  it('deletes a base once nothing is built on it', async () => {
    const base = await createBase();
    await deleteMachine(store, paths, base.id);

    expect(store.findMachine(base.id)).toBeUndefined();
  });
});

describe('machine profiles as records', () => {
  it('stores the profile in the database, not as a file beside the VMID', async () => {
    const machine = await createMachine(store, paths, {
      name: 'Recorded',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({ id: 'ignored', axes: 4 }),
    });

    expect(store.findMachine(machine.id)?.profile).toContain('"axes":4');
    expect(
      await Bun.file(
        path.join(paths.machines, machine.id, 'machine.json'),
      ).exists(),
    ).toBe(false);
  });

  it('returns the stored profile so the form can edit it', async () => {
    // A form that cannot read the current values can only offer to replace
    // them wholesale, which is the file upload this replaced.
    const machine = await createMachine(store, paths, {
      name: 'Editable',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({
        id: 'editable',
        axes: 4,
        features: { maxSpindleSpeed: 8000 },
        home: { x: -465, y: 190, z: 0 },
      }),
    });

    expect(machine.profile).toMatchObject({
      axes: 4,
      features: { maxSpindleSpeed: 8000 },
      home: { x: -465, y: 190, z: 0 },
    });
  });

  it("imposes the machine's own id and name on the profile", async () => {
    // `extends` names machines by id, so a profile carrying someone else's id
    // would be a trap nobody could see from the form.
    const machine = await createMachine(store, paths, {
      name: 'Imposed Identity',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({
        id: 'somebody-elses-id',
        name: 'Some Other Name',
        axes: 3,
      }),
    });

    expect(machine.profile?.id).toBe(machine.id);
    expect(machine.profile?.name).toBe('Imposed Identity');
  });

  it('treats a profile that states nothing as no profile at all', async () => {
    const machine = await createMachine(store, paths, {
      name: 'Empty Form',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({ id: 'empty' }),
    });

    expect(machine.hasProfile).toBe(false);
    expect(machine.profile).toBeNull();
  });

  it("keeps the profile's name in step with a rename", async () => {
    const machine = await createMachine(store, paths, {
      name: 'Before',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({ id: 'x', axes: 3 }),
    });

    const renamed = await updateMachine(store, paths, machine.id, {
      name: 'After',
    });

    expect(renamed.profile?.name).toBe('After');
    expect(renamed.profile?.axes).toBe(3);
  });

  it('clears a profile when asked, leaving the machine', async () => {
    const machine = await createMachine(store, paths, {
      name: 'Cleared',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({ id: 'cleared', axes: 4 }),
    });

    const updated = await updateMachine(store, paths, machine.id, {
      clearProfile: true,
    });

    expect(updated.hasProfile).toBe(false);
    expect(
      (await loadMachineDocuments(store, paths, machine.id)).machineProfile,
    ).toBeUndefined();
  });
});

/**
 * The job cache keys on the machine's revision, not just its id.
 *
 * These are regression tests for a real incident: an operator set a machine's
 * dialect to `poyakar-1160l`, re-posted the same trace, and got back the
 * pre-edit G-code with its uncompacted coordinates. Nothing was broken in the
 * post — `submitJob` matched the earlier job on `machine_id` alone and never
 * ran the new configuration at all. The give-away was that no new job row
 * appeared: a cache hit returns before one is written.
 */
describe('job cache invalidation', () => {
  const seedTrace = (sha: string) => {
    store.createTrace({ sha256: sha, name: `${sha}.MPF`, bytes: 10 });
    store.markTraceReady(sha, {
      setups: [],
      hasImplicitSetup: false,
      timing: null,
      profile: null,
      diagnostics: [],
      eventCount: 1,
    });
  };

  const postJob = (id: string, machineId: string, revision: number) => {
    store.createJob({
      id,
      traceSha256: 'sha',
      traceName: 'sha.MPF',
      traceBytes: 10,
      machineId,
      programName: null,
      setups: null,
      keepAllTools: false,
      machineRevision: revision,
    });
    store.markDone(id, {
      files: [],
      diagnostics: [],
      timing: null,
      profile: null,
      selectedSetups: null,
    });
  };

  const keyFor = (machineId: string, revision: number) => ({
    traceSha256: 'sha',
    machineId,
    machineRevision: revision,
    programName: null,
    setups: null,
    keepAllTools: false,
  });

  it('bumps the revision on every write to a machine', async () => {
    const created = await createMachine(store, paths, {
      name: 'Mill',
      postId: 'siemens-828d',
    });
    expect(store.findMachine(created.id)?.revision).toBe(1);

    await updateMachine(store, paths, created.id, {
      machineProfile: JSON.stringify({ dialect: 'poyakar-1160l' }),
    });

    expect(store.findMachine(created.id)?.revision).toBe(2);
  });

  it('stops an edited machine from serving its pre-edit output', async () => {
    seedTrace('sha');
    const machine = await createMachine(store, paths, {
      name: 'Mill',
      postId: 'siemens-828d',
    });
    postJob('before-edit', machine.id, revisionOf(machine.id));

    // Same trace, same machine, same everything the operator typed.
    expect(
      store.findCachedJob(keyFor(machine.id, revisionOf(machine.id)))?.id,
    ).toBe('before-edit');

    await updateMachine(store, paths, machine.id, {
      machineProfile: JSON.stringify({ dialect: 'poyakar-1160l' }),
    });

    // The dialect decides how coordinates are written, so the earlier bytes
    // are not the answer any more. Re-posting has to do the work again.
    expect(
      store.findCachedJob(keyFor(machine.id, revisionOf(machine.id))),
    ).toBeUndefined();
  });

  it('still caches when the machine has not moved', async () => {
    seedTrace('sha');
    const machine = await createMachine(store, paths, {
      name: 'Mill',
      postId: 'siemens-828d',
      machineProfile: JSON.stringify({ dialect: 'poyakar-1160l' }),
    });
    postJob('first', machine.id, revisionOf(machine.id));

    // The point of the cache survives: an unchanged machine must not re-run a
    // fifteen-second parse to reproduce bytes already on disk.
    expect(
      store.findCachedJob(keyFor(machine.id, revisionOf(machine.id)))?.id,
    ).toBe('first');
  });

  it('never serves a job that predates the revision column', async () => {
    seedTrace('sha');
    const machine = await createMachine(store, paths, {
      name: 'Mill',
      postId: 'siemens-828d',
    });
    postJob('legacy', machine.id, revisionOf(machine.id));
    clearMachineRevision('legacy');

    // Which configuration that job used was never recorded, so no claim that
    // it matches today's can be honest. It stays in history and out of the
    // cache.
    expect(
      store.findCachedJob(keyFor(machine.id, revisionOf(machine.id))),
    ).toBeUndefined();
  });

  function revisionOf(id: string): number {
    const machine = store.findMachine(id);
    if (!machine) throw new Error(`Unknown machine '${id}'`);
    return machine.revision;
  }
});

describe('migrateWorkshopData', () => {
  it('moves a profile still living in machines/<id>/machine.json', async () => {
    const machine = await createMachine(store, paths, {
      name: 'Legacy Machine',
      postId: 'siemens-828d',
    });
    // The shape a pre-migration deployment leaves behind: a file on the volume
    // and a row pointing at it by name.
    const file = path.join(paths.machines, machine.id, 'machine.json');
    await Bun.write(file, JSON.stringify({ id: machine.id, axes: 4 }));
    legacyProfileFile(machine.id, 'machine.json');

    await migrateWorkshopData(store, paths);

    expect(store.findMachine(machine.id)?.profile).toContain('"axes":4');
    expect(await Bun.file(file).exists()).toBe(false);
  });

  it('adopts a trace still living under its job id', async () => {
    store.createJob({
      id: 'legacy-job',
      traceSha256: 'legacy-sha',
      traceName: 'old.MPF',
      traceBytes: 11,
      machineId: 'gone',
      programName: null,
      setups: null,
      keepAllTools: false,
      machineRevision: 1,
    });
    await Bun.write(legacyJobTracePath(paths, 'legacy-job'), 'trace bytes');

    await migrateWorkshopData(store, paths);

    // Adopted rather than re-analysed: a deployment with hundreds of jobs must
    // not spend its first minutes re-parsing every trace anyone uploaded.
    expect(store.findTrace('legacy-sha')?.status).toBe('ready');
    expect(await Bun.file(traceFilePath(paths, 'legacy-sha')).text()).toBe(
      'trace bytes',
    );
    expect(
      await Bun.file(legacyJobTracePath(paths, 'legacy-job')).exists(),
    ).toBe(false);
  });
});

/**
 * Recreates the `profile_file` column an older database still has, so the
 * migration has something to find. Done over a second connection, because
 * `JobStore` has no reason to be able to write a column it has replaced.
 */
function legacyProfileFile(machineId: string, filename: string): void {
  const db = new Database(paths.database);
  try {
    const columns = db.query('PRAGMA table_info(machines)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'profile_file')) {
      db.exec('ALTER TABLE machines ADD COLUMN profile_file TEXT');
    }
    db.query(
      'UPDATE machines SET profile_file = ?, profile = NULL WHERE id = ?',
    ).run(filename, machineId);
  } finally {
    db.close();
  }
}

/**
 * Blanks a job's `machine_revision`, reproducing a row written before the
 * column existed. Over a second connection for the same reason as
 * {@link legacyProfileFile}: `JobStore` has no legitimate way to unset it.
 */
function clearMachineRevision(jobId: string): void {
  const db = new Database(paths.database);
  try {
    db.query('UPDATE jobs SET machine_revision = NULL WHERE id = ?').run(jobId);
  } finally {
    db.close();
  }
}
