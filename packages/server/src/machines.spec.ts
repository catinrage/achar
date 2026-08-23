import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { DataPaths } from './data/paths';
import { prepareDataPaths } from './data/paths';
import { JobStore } from './data/store';
import { HttpError } from './errors';
import { createMachine, deleteMachine, loadMachineDocuments } from './machines';

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
