import { describe, expect, it } from 'bun:test';
import {
  POYAKAR_1160L_DIALECT,
  resolveSiemens828dDialect,
  SIEMENS_828D_DIALECTS,
  SIEMENS_828D_STOCK_DIALECT,
  type Siemens828dDialect,
} from './dialect';

describe('siemens 828d dialects', () => {
  it('falls back to stock when a profile names no dialect', () => {
    expect(resolveSiemens828dDialect(undefined)).toBe(
      SIEMENS_828D_STOCK_DIALECT,
    );
  });

  it('resolves a named dialect', () => {
    expect(resolveSiemens828dDialect('poyakar-1160l')).toBe(
      POYAKAR_1160L_DIALECT,
    );
  });

  it('rejects an unknown dialect instead of silently posting stock', () => {
    // A typo that fell back to stock would emit a plausible file that is
    // wrong in a dozen scattered places, which is the failure this whole
    // mechanism exists to prevent.
    expect(() => resolveSiemens828dDialect('poyakar-1160')).toThrow(
      /Unknown Siemens 828D dialect 'poyakar-1160'/,
    );
  });

  it('leaves every dialect trait fully specified', () => {
    // Dialects are presets, not overlays: a read site must never have to
    // decide what a missing trait would have meant.
    const traits = Object.keys(
      SIEMENS_828D_STOCK_DIALECT,
    ) as (keyof Siemens828dDialect)[];

    for (const [id, dialect] of Object.entries(SIEMENS_828D_DIALECTS)) {
      for (const trait of traits) {
        expect(`${id}.${trait}=${typeof dialect[trait]}`).toBe(
          `${id}.${trait}=boolean`,
        );
      }
    }
  });

  it('keeps stock on the behaviour a profile-less post had before the split', () => {
    // These were the defaults spelled out at each read site in post.ts as
    // `?? true` / `=== true` / `!== false`. Pinning them here is what makes
    // the split provably behaviour-preserving for every machine that names
    // no dialect.
    expect(SIEMENS_828D_STOCK_DIALECT).toEqual({
      drillApproachZBeforeCoolant: false,
      cancelAirCoolantSchedule: true,
      lineFeedFromChangeFlag: false,
      trackArcFeedRate: false,
      inlineFeedRateMode: true,
      compactCoordinates: false,
      mainToolListComments: false,
      forceInitialApproachPosition: false,
      toolMeasurementProgramDeferred: false,
      startPositionRequiresToolChange: false,
    });
  });

  it('reproduces the PoyaKar flags the machine profile used to carry', () => {
    expect(POYAKAR_1160L_DIALECT).toEqual({
      drillApproachZBeforeCoolant: true,
      cancelAirCoolantSchedule: false,
      lineFeedFromChangeFlag: true,
      trackArcFeedRate: true,
      inlineFeedRateMode: false,
      compactCoordinates: true,
      mainToolListComments: true,
      forceInitialApproachPosition: true,
      toolMeasurementProgramDeferred: true,
      startPositionRequiresToolChange: true,
    });
  });
});
