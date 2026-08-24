import { describe, expect, it } from 'bun:test';
import {
  MACHINE_FEATURE_SPECS,
  machineFeatureSchema,
  parseMachineFeatures,
} from './machine-features';

describe('machine feature table', () => {
  it('accepts every declared property at its declared type', () => {
    const features = parseMachineFeatures(
      {
        toolMeasurementProgram: true,
        dwellAfterCoolantOn: false,
        maxSpindleSpeed: 8000,
        toolChanger: 'umbrella',
      },
      'profile',
    );

    expect(features).toEqual({
      toolMeasurementProgram: true,
      dwellAfterCoolantOn: false,
      maxSpindleSpeed: 8000,
      toolChanger: 'umbrella',
    });
  });

  it('rejects an unrecognised property instead of dropping it', () => {
    // A key nobody reads is a setting the author believes is in force and is
    // not — G-code that differs from what the profile describes.
    expect(() =>
      parseMachineFeatures({ dwellAfterCoolent: true }, 'profile'),
    ).toThrow(/unrecognised properties: dwellAfterCoolent/);
  });

  it('names where a moved dialect trait went', () => {
    expect(() =>
      parseMachineFeatures({ compactCoordinates: true }, 'profile'),
    ).toThrow(/dialect traits that are no longer machine properties/);
  });

  it('holds numbers to their declared bounds', () => {
    expect(() =>
      parseMachineFeatures({ maxSpindleSpeed: 0 }, 'profile'),
    ).toThrow('profile.features.maxSpindleSpeed must be at least 1.');
    expect(() =>
      parseMachineFeatures({ maxSpindleSpeed: 8000.5 }, 'profile'),
    ).toThrow('must be a whole number');
    expect(() =>
      parseMachineFeatures({ maxSpindleSpeed: '8000' }, 'profile'),
    ).toThrow('must be a finite number');
  });

  it('holds enums to their declared values', () => {
    expect(() =>
      parseMachineFeatures({ toolChanger: 'gantry' }, 'profile'),
    ).toThrow('must be one of: carousel, umbrella, manual');
  });

  it('still type-checks booleans', () => {
    expect(() =>
      parseMachineFeatures({ dwellAfterCoolantOn: 'yes' }, 'profile'),
    ).toThrow('profile.features.dwellAfterCoolantOn must be a boolean.');
  });

  it('describes every property to a form, from the same rows', () => {
    // The schema is the table, so a property cannot exist without the UI
    // being able to render it.
    const schema = machineFeatureSchema();

    expect(schema.map((spec) => spec.key)).toEqual(
      MACHINE_FEATURE_SPECS.map((spec) => spec.key),
    );
    for (const spec of schema) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  it('hands out a copy a caller cannot use to edit the table', () => {
    const schema = machineFeatureSchema();
    schema[0].label = 'mutated';

    expect(machineFeatureSchema()[0].label).not.toBe('mutated');
  });
});
