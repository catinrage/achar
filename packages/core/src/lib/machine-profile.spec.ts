import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadMachineProfile,
  type MachineProfile,
  mergeMachineProfiles,
  parseMachineProfile,
  requireMachineProfile,
  resolveMachineProfileChain,
  validateMachineProfileCompatibility,
} from './machine-profile';

describe('machine profiles', () => {
  it('parses machine properties and the named dialect', () => {
    const profile = parseMachineProfile({
      id: 'poyakar-1160l-3a',
      name: 'PoyaKar 1160L 3A',
      controller: 'siemens-828d',
      axes: 3,
      dialect: 'Siemens_828D_Milling_3A',
      features: {
        toolMeasurementProgram: true,
        dwellAfterCoolantOn: true,
        dwellAfterCoolantOff: true,
        tapCycleOptionalStop: true,
      },
      home: { x: -465, y: 190, z: 0 },
      returnHome: { x: 260, y: 190, z: 0 },
    });

    expect(profile).toEqual({
      id: 'poyakar-1160l-3a',
      name: 'PoyaKar 1160L 3A',
      controller: 'siemens-828d',
      axes: 3,
      dialect: 'Siemens_828D_Milling_3A',
      features: {
        toolMeasurementProgram: true,
        dwellAfterCoolantOn: true,
        dwellAfterCoolantOff: true,
        tapCycleOptionalStop: true,
      },
      home: { x: -465, y: 190, z: 0 },
      returnHome: { x: 260, y: 190, z: 0 },
    });
  });

  it('rejects dialect traits left in features rather than ignoring them', () => {
    expect(() =>
      parseMachineProfile(
        {
          id: 'legacy-profile',
          features: { compactCoordinates: true, trackArcFeedRate: true },
        },
        'legacy.machine.json',
      ),
    ).toThrow(
      /dialect traits that are no longer machine properties: trackArcFeedRate, compactCoordinates/,
    );
  });

  it('keeps a profile with no dialect on the post default', () => {
    expect(parseMachineProfile({ id: 'plain' }).dialect).toBeUndefined();
  });

  it('reports profile axis mismatch against trace and VMID data', () => {
    const profile = parseMachineProfile({ id: 'four-axis', axes: 4 });
    const issues = validateMachineProfileCompatibility(
      profile,
      [
        {
          _eventName: 'StartOfFile',
          _index: 0,
          iNumberOfAixs: 3,
        },
      ],
      {
        vmid: {
          machine: {},
          axes: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }],
          postProcessors: [],
          parameters: [],
        },
      },
    );

    expect(issues).toEqual([
      {
        severity: 'error',
        event: 'StartOfFile',
        key: 'iNumberOfAixs',
        message:
          'Machine profile four-axis declares 4 axes, but the trace declares 3.',
      },
      {
        severity: 'error',
        key: 'axes',
        message:
          'Machine profile four-axis declares 4 axes, but the VMID defines 3.',
      },
    ]);
  });

  it('refuses a program that outruns the machine spindle', () => {
    const profile = parseMachineProfile({
      id: 'slow-spindle',
      features: { maxSpindleSpeed: 8000 },
    });

    const issues = validateMachineProfileCompatibility(profile, [
      { _eventName: 'MFeedSpin', _index: 0, spin: 6000 },
      { _eventName: 'Drill', _index: 1, spin: 12000 },
      { _eventName: 'MFeedSpin', _index: 2, spin: 9000 },
    ]);

    // One issue naming the worst offender, not one per event: a program over
    // the limit is usually over it thousands of times.
    expect(issues).toEqual([
      {
        severity: 'error',
        event: 'Drill',
        key: 'spin',
        message:
          'Machine profile slow-spindle allows 8000 rpm, but the program commands up to 12000 rpm.',
      },
    ]);
  });

  it('passes a program inside the spindle limit', () => {
    const profile = parseMachineProfile({
      id: 'slow-spindle',
      features: { maxSpindleSpeed: 8000 },
    });

    expect(
      validateMachineProfileCompatibility(profile, [
        { _eventName: 'Drill', _index: 0, spin: 8000 },
      ]),
    ).toEqual([]);
  });

  it('says nothing about spindle speed when the machine declares no limit', () => {
    expect(
      validateMachineProfileCompatibility(
        parseMachineProfile({ id: 'unlimited' }),
        [{ _eventName: 'Drill', _index: 0, spin: 30000 }],
      ),
    ).toEqual([]);
  });

  it('refuses a profile bound to a post for another control', () => {
    const issues = validateMachineProfileCompatibility(
      parseMachineProfile({ id: 'fanuc-cell', controller: 'fanuc-0i' }),
      [],
      { post: { id: 'siemens-828d', controller: 'siemens-828d' } },
    );

    expect(issues).toEqual([
      {
        severity: 'error',
        key: 'controller',
        message:
          'Machine profile fanuc-cell is for a fanuc-0i control, but post siemens-828d emits for siemens-828d.',
      },
    ]);
  });

  it('refuses a dialect the bound post does not define', () => {
    const issues = validateMachineProfileCompatibility(
      parseMachineProfile({ id: 'typo', dialect: 'poyakar-1160' }),
      [],
      { post: { id: 'siemens-828d', dialects: ['Siemens_828D_Milling_4A'] } },
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.key).toBe('dialect');
  });

  it('says nothing about a post that declares no controller or dialects', () => {
    // A custom post module can target whatever it likes.
    expect(
      validateMachineProfileCompatibility(
        parseMachineProfile({
          id: 'anything',
          controller: 'heidenhain',
          dialect: 'whatever',
        }),
        [],
        { post: { id: 'custom' } },
      ),
    ).toEqual([]);
  });

  it('refuses a park position outside the VMID travel limits', () => {
    const issues = validateMachineProfileCompatibility(
      parseMachineProfile({
        id: 'unreachable',
        home: { x: -900, y: 0, z: 0 },
        returnHome: { x: 0, y: 0, z: 700 },
      }),
      [],
      {
        vmid: {
          machine: {},
          axes: [
            { name: 'X', min: -550, max: 550 },
            { name: 'Y', min: -300, max: 300 },
            { name: 'Z', min: 0, max: 600 },
          ],
          postProcessors: [],
          parameters: [],
        },
      },
    );

    expect(issues.map((issue) => issue.key)).toEqual([
      'home.x',
      'returnHome.z',
    ]);
    expect(issues[0]?.message).toContain(
      'puts home X at -900, outside the VMID travel limits -550 to 550',
    );
  });

  it('ignores rotary axes when checking park positions', () => {
    // `home` has no A coordinate, so a rotary axis has nothing to compare.
    expect(
      validateMachineProfileCompatibility(
        parseMachineProfile({ id: 'four-axis', home: { x: 0, y: 0, z: 0 } }),
        [],
        {
          vmid: {
            machine: {},
            axes: [
              { name: 'X', min: -550, max: 550 },
              { name: 'Y', min: -300, max: 300 },
              { name: 'Z', min: 0, max: 600 },
              { name: 'A', min: -100000, max: 100000 },
            ],
            postProcessors: [],
            parameters: [],
          },
        },
      ),
    ).toEqual([]);
  });

  it('throws a clear error when required profile data is missing', () => {
    expect(() =>
      requireMachineProfile(undefined, 'machine-specific coolant policy'),
    ).toThrow(
      'Machine profile is missing; machine-specific coolant policy requires one.',
    );
  });
});

describe('machine profile inheritance', () => {
  const base = parseMachineProfile({
    id: 'shop-base',
    name: 'Shop Base',
    controller: 'siemens-828d',
    axes: 3,
    dialect: 'Siemens_828D_Milling_3A',
    features: { dwellAfterCoolantOn: true, tapCycleOptionalStop: true },
    home: { x: -465, y: 190, z: 0 },
  });

  const library = (...profiles: MachineProfile[]) => {
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    return (reference: string) => byId.get(reference);
  };

  it('lets a derived profile state only its delta', async () => {
    const derived = parseMachineProfile({
      id: 'cell-2',
      extends: 'shop-base',
      axes: 4,
    });

    const resolved = await resolveMachineProfileChain(derived, library(base));

    expect(resolved).toEqual({
      id: 'cell-2',
      name: 'Shop Base',
      controller: 'siemens-828d',
      axes: 4,
      dialect: 'Siemens_828D_Milling_3A',
      features: { dwellAfterCoolantOn: true, tapCycleOptionalStop: true },
      home: { x: -465, y: 190, z: 0 },
      returnHome: undefined,
    });
  });

  it('merges one level into features and home, not wholesale', () => {
    const merged = mergeMachineProfiles(
      base,
      parseMachineProfile({
        id: 'cell-3',
        features: { dwellAfterCoolantOn: false },
        home: { x: -100 },
      }),
    );

    // The keys the derived profile did not mention survive; a whole-section
    // replacement would have dropped tapCycleOptionalStop and home.y/z.
    expect(merged.features).toEqual({
      dwellAfterCoolantOn: false,
      tapCycleOptionalStop: true,
    });
    expect(merged.home).toEqual({ x: -100, y: 190, z: 0 });
  });

  it('never inherits an id', () => {
    expect(
      mergeMachineProfiles(base, parseMachineProfile({ id: 'cell-4' })).id,
    ).toBe('cell-4');
  });

  it('applies the nearest profile last down a chain', async () => {
    const middle = parseMachineProfile({
      id: 'middle',
      extends: 'shop-base',
      axes: 4,
      features: { dwellAfterCoolantOff: true },
    });
    const leaf = parseMachineProfile({
      id: 'leaf',
      extends: 'middle',
      axes: 5,
    });

    const resolved = await resolveMachineProfileChain(
      leaf,
      library(base, middle),
    );

    expect(resolved.axes).toBe(5);
    expect(resolved.features).toEqual({
      dwellAfterCoolantOn: true,
      tapCycleOptionalStop: true,
      dwellAfterCoolantOff: true,
    });
  });

  it('leaves a profile without extends untouched', async () => {
    expect(await resolveMachineProfileChain(base, library())).toBe(base);
  });

  it('reports a base that cannot be found', async () => {
    const orphan = parseMachineProfile({ id: 'orphan', extends: 'missing' });
    await expect(resolveMachineProfileChain(orphan, library())).rejects.toThrow(
      "Machine profile orphan extends 'missing', which could not be found.",
    );
  });

  it('reports a cycle instead of looping', async () => {
    const left = parseMachineProfile({ id: 'left', extends: 'right' });
    const right = parseMachineProfile({ id: 'right', extends: 'left' });

    await expect(
      resolveMachineProfileChain(left, library(left, right)),
    ).rejects.toThrow('circular extends chain');
  });

  it('does not mistake a shared profile id for a cycle', async () => {
    // Two machines built from one template legitimately carry the same
    // internal id; that is the case this feature exists for.
    const twin = parseMachineProfile({ id: 'shop-base', extends: 'shop-base' });
    const resolved = await resolveMachineProfileChain(twin, library(base));

    expect(resolved.axes).toBe(3);
  });
});

describe('loadMachineProfile', () => {
  let root: string;

  beforeEach(async () => {
    root = path.join('/tmp', `achar-profiles-${Bun.randomUUIDv7()}`);
    await mkdir(path.join(root, 'cells'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = (relative: string, value: object) =>
    writeFile(path.join(root, relative), JSON.stringify(value));

  it('resolves extends as a path relative to the file that names it', async () => {
    await write('base.machine.json', {
      id: 'base',
      axes: 3,
      features: { dwellAfterCoolantOn: true },
    });
    await write('cells/two.machine.json', {
      id: 'cell-2',
      extends: '../base.machine.json',
      axes: 4,
    });

    const profile = await loadMachineProfile(
      path.join(root, 'cells/two.machine.json'),
    );

    expect(profile.id).toBe('cell-2');
    expect(profile.axes).toBe(4);
    expect(profile.features).toEqual({ dwellAfterCoolantOn: true });
    // The result is flat, so nothing downstream has to resolve it again.
    expect(profile.extends).toBeUndefined();
  });

  it('refuses a base outside a caller-supplied root', async () => {
    await write('cells/escape.machine.json', {
      id: 'escape',
      extends: '../../etc/other.machine.json',
    });

    await expect(
      loadMachineProfile(path.join(root, 'cells/escape.machine.json'), {
        root: path.join(root, 'cells'),
      }),
    ).rejects.toThrow(/which is outside/);
  });

  it('detects a cycle reached through two different relative paths', async () => {
    await write('cells/a.machine.json', {
      id: 'a',
      extends: './b.machine.json',
    });
    await write('cells/b.machine.json', {
      id: 'b',
      extends: '../cells/a.machine.json',
    });

    await expect(
      loadMachineProfile(path.join(root, 'cells/a.machine.json')),
    ).rejects.toThrow('circular extends chain');
  });
});
