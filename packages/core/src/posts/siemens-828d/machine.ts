import type { MachineProfile } from '../../lib/machine-profile';

/**
 * One machine's settings, fully resolved.
 *
 * Every field is required. The post asks this object what a machine does and
 * gets an answer, rather than each read site re-deciding what an absent value
 * meant — which is how `?? true`, `=== true`, and `!== false` all came to
 * describe defaults for the same profile, three lines apart.
 *
 * Defaults live here, with the post, because a missing value only means
 * anything relative to a post: "no `toolMeasurementProgram`" resolves to true
 * not because machines usually have probes but because this post emits the
 * measurement program unless told otherwise.
 */
export interface Siemens828dMachineSettings {
  home: Required<Position>;
  returnHome: Required<Position>;
  /**
   * Where a tool change parks when the job asks for one but names no
   * position. A job carries `nTC_XSUPA`/`nTC_YSUPA`, and the legacy post
   * reads a zero there as "unset" and substitutes these — they are their own
   * pair, not `home`, which they only coincide with in X.
   */
  toolChangePark: Required<Pick<Position, 'x' | 'y'>>;
  /** Emit `Tools_Length_Measurement.MPF` for this machine. */
  measureTools: boolean;
  /** Coolant needs a dwell after `M8` before cutting starts. */
  dwellAfterCoolantOn: boolean;
  /** Coolant needs a dwell after the final `M9`. */
  dwellAfterCoolantOff: boolean;
  /** Tapping cycles get an operator stop before every call. */
  tapCycleOptionalStop: boolean;
}

interface Position {
  x?: number;
  y?: number;
  z?: number;
}

/**
 * What a machine that says nothing about itself gets.
 *
 * These are the values the post applied inline before this resolver existed,
 * so a profile-less machine keeps posting exactly as it did. The home
 * coordinates were bare literals at their read sites; they are named here so
 * there is one place to look when a machine parks somewhere else.
 */
export const SIEMENS_828D_MACHINE_DEFAULTS: Siemens828dMachineSettings = {
  home: { x: -465, y: 190, z: 0 },
  returnHome: { x: 260, y: 190, z: 0 },
  toolChangePark: { x: -465, y: 140 },
  measureTools: true,
  dwellAfterCoolantOn: false,
  dwellAfterCoolantOff: false,
  tapCycleOptionalStop: false,
};

export interface Siemens828dMachineOverrides {
  home?: Position;
  returnHome?: Position;
  toolChangePark?: Pick<Position, 'x' | 'y'>;
  measureTools?: boolean;
}

/**
 * Folds a profile and any caller overrides onto the defaults, once.
 *
 * Precedence is explicit override, then profile, then default. Overrides
 * exist for run-scoped choices — `measureTools` is a per-posting SolidCAM
 * option, not a machine property — and for tests that need one value moved.
 *
 * An unresolved `extends` is refused rather than ignored. A profile that
 * reaches a post still naming a base has had its inherited values silently
 * dropped, and the post would emit a plausible file built from defaults the
 * machine never asked for.
 */
export function resolveSiemens828dMachine(
  profile?: MachineProfile,
  overrides: Siemens828dMachineOverrides = {},
): Siemens828dMachineSettings {
  if (profile?.extends !== undefined) {
    throw new Error(
      `Machine profile ${profile.id} still extends '${profile.extends}'; resolve the chain before posting with it.`,
    );
  }

  const features = profile?.features;
  const defaults = SIEMENS_828D_MACHINE_DEFAULTS;

  return {
    home: mergePosition(defaults.home, profile?.home, overrides.home),
    returnHome: mergePosition(
      defaults.returnHome,
      profile?.returnHome,
      overrides.returnHome,
    ),
    // Not a profile field: the legacy post hardcodes this pair, so it is a
    // post constant with an override hook, not something a machine states.
    // Promote it to `MachineProfile` if a machine ever parks elsewhere.
    toolChangePark: {
      x: overrides.toolChangePark?.x ?? defaults.toolChangePark.x,
      y: overrides.toolChangePark?.y ?? defaults.toolChangePark.y,
    },
    measureTools:
      overrides.measureTools ??
      features?.toolMeasurementProgram ??
      defaults.measureTools,
    dwellAfterCoolantOn:
      features?.dwellAfterCoolantOn ?? defaults.dwellAfterCoolantOn,
    dwellAfterCoolantOff:
      features?.dwellAfterCoolantOff ?? defaults.dwellAfterCoolantOff,
    tapCycleOptionalStop:
      features?.tapCycleOptionalStop ?? defaults.tapCycleOptionalStop,
  };
}

function mergePosition(
  fallback: Required<Position>,
  profile: Position | undefined,
  override: Position | undefined,
): Required<Position> {
  return {
    x: override?.x ?? profile?.x ?? fallback.x,
    y: override?.y ?? profile?.y ?? fallback.y,
    z: override?.z ?? profile?.z ?? fallback.z,
  };
}
