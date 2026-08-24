import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '@achar/server';
import type { DataPaths } from './data/paths';
import { prepareDataPaths } from './data/paths';
import { JobStore } from './data/store';
import {
  createMachine,
  deleteMachine,
  loadMachineDocuments,
  updateMachine,
} from './machines';

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
