import { describe, expect, it } from 'vitest';
import {
  parseMachineProfile,
  requireMachineProfile,
  validateMachineProfileCompatibility,
} from './machine-profile';

describe('machine profiles', () => {
  it('parses optional machine policy fields', () => {
    const profile = parseMachineProfile({
      id: 'poyakar-1160l-3a',
      name: 'PoyaKar 1160L 3A',
      controller: 'siemens-828d',
      axes: 3,
      features: {
        toolMeasurementProgram: true,
        toolMeasurementProgramDeferred: true,
        mainToolListComments: true,
        dwellAfterCoolantOn: true,
        dwellAfterCoolantOff: true,
        cancelAirCoolantSchedule: false,
        forceInitialApproachPosition: true,
        inlineFeedRateMode: false,
        compactCoordinates: true,
      },
      home: { x: -465, y: 190, z: 0 },
      returnHome: { x: 260, y: 190, z: 0 },
    });

    expect(profile).toEqual({
      id: 'poyakar-1160l-3a',
      name: 'PoyaKar 1160L 3A',
      controller: 'siemens-828d',
      axes: 3,
      features: {
        toolMeasurementProgram: true,
        toolMeasurementProgramDeferred: true,
        mainToolListComments: true,
        dwellAfterCoolantOn: true,
        dwellAfterCoolantOff: true,
        cancelAirCoolantSchedule: false,
        forceInitialApproachPosition: true,
        inlineFeedRateMode: false,
        compactCoordinates: true,
      },
      home: { x: -465, y: 190, z: 0 },
      returnHome: { x: 260, y: 190, z: 0 },
    });
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
        machine: {},
        axes: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }],
        postProcessors: [],
        parameters: [],
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

  it('throws a clear error when required profile data is missing', () => {
    expect(() =>
      requireMachineProfile(undefined, 'machine-specific coolant policy'),
    ).toThrow(
      'Machine profile is missing; machine-specific coolant policy requires one.',
    );
  });
});
