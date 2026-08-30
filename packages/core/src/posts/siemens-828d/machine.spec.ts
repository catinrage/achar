import { describe, expect, it } from 'bun:test';
import { parseMachineProfile } from '../../lib/machine-profile';
import {
  resolveSiemens828dMachine,
  SIEMENS_828D_MACHINE_DEFAULTS,
} from './machine';

describe('siemens 828d machine settings', () => {
  it('gives a profile-less machine the behaviour it had before the resolver', () => {
    // These were the `?? true` / `=== true` / bare-literal defaults spelled
    // out at each read site in post.ts. Pinning them is what makes the
    // resolver provably behaviour-preserving.
    expect(resolveSiemens828dMachine(undefined)).toEqual({
      home: { x: -465, y: 190, z: 0 },
      returnHome: { x: 260, y: 190, z: 0 },
      toolChangePark: { x: -465, y: 140 },
      measureTools: true,
      dwellAfterCoolantOn: false,
      dwellAfterCoolantOff: false,
      tapCycleOptionalStop: false,
    });
  });

  it('leaves every setting defined for a profile that states nothing', () => {
    const settings = resolveSiemens828dMachine(
      parseMachineProfile({ id: 'bare' }),
    );

    expect(settings).toEqual(SIEMENS_828D_MACHINE_DEFAULTS);
    for (const value of Object.values(settings)) {
      expect(value).toBeDefined();
    }
  });

  it('takes a stated false over a true default', () => {
    // The distinction `?? true` could not draw: "says nothing" and "says no"
    // have to differ, or a machine can never turn the probe off.
    const settings = resolveSiemens828dMachine(
      parseMachineProfile({
        id: 'no-probe',
        features: { toolMeasurementProgram: false },
      }),
    );

    expect(settings.measureTools).toBe(false);
  });

  it('fills only the home axes a profile omits', () => {
    const settings = resolveSiemens828dMachine(
      parseMachineProfile({ id: 'shifted', home: { x: -100 } }),
    );

    expect(settings.home).toEqual({ x: -100, y: 190, z: 0 });
  });

  it('puts a caller override above the profile', () => {
    const settings = resolveSiemens828dMachine(
      parseMachineProfile({
        id: 'probed',
        features: { toolMeasurementProgram: true },
        home: { x: -465, y: 190, z: 0 },
      }),
      { measureTools: false, home: { z: 5 } },
    );

    expect(settings.measureTools).toBe(false);
    expect(settings.home).toEqual({ x: -465, y: 190, z: 5 });
  });

  it('refuses a profile whose extends was never resolved', () => {
    // Posting it would silently drop every inherited value and build G-code
    // from defaults the machine never asked for.
    expect(() =>
      resolveSiemens828dMachine(
        parseMachineProfile({ id: 'derived', extends: 'shop-base' }),
      ),
    ).toThrow("Machine profile derived still extends 'shop-base'");
  });
});
