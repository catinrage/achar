/**
 * The machine-property vocabulary, declared once.
 *
 * Every machine feature is one row here. The row is the whole definition: it
 * types the field, validates a loaded profile, and describes the field to a
 * UI that has to render a form for it. Adding a property is adding a row.
 *
 * It used to take four edits — an interface member, ten lines of hand-rolled
 * checking, a read site, and every machine's JSON — and the four could
 * disagree. A property that parsed but had no interface member was simply
 * dropped on load, which is the failure mode this whole subsystem exists to
 * make impossible.
 *
 * What a row does *not* carry is a default. A missing value means nothing on
 * its own: "no `toolMeasurementProgram`" resolves to true because the Siemens
 * post emits the measurement program unless told otherwise, not because
 * machines generally have probes. Defaults belong to the post that reads
 * them — see `SIEMENS_828D_MACHINE_DEFAULTS`.
 */

interface SpecBase {
  /** JSON key under `features`. */
  key: string;
  /** Short human label for a form field. */
  label: string;
  /** What the property means to someone standing at the machine. */
  description: string;
}

export interface BooleanFeatureSpec extends SpecBase {
  kind: 'boolean';
}

export interface NumberFeatureSpec extends SpecBase {
  kind: 'number';
  /** Rejected below this. */
  min?: number;
  /** Rejected above this. */
  max?: number;
  /** Whole numbers only. */
  integer?: boolean;
  /** Shown beside the field; never parsed out of the value. */
  unit?: string;
}

export interface EnumFeatureSpec extends SpecBase {
  kind: 'enum';
  values: readonly string[];
}

export type MachineFeatureSpec =
  | BooleanFeatureSpec
  | NumberFeatureSpec
  | EnumFeatureSpec;

export const MACHINE_FEATURE_SPECS = [
  {
    key: 'toolMeasurementProgram',
    kind: 'boolean',
    label: 'Tool-length probe',
    description:
      'The machine can measure tool length, so a measurement program is worth emitting.',
  },
  {
    key: 'dwellAfterCoolantOn',
    kind: 'boolean',
    label: 'Dwell after coolant on',
    description:
      'Coolant needs a pause after M8 to reach pressure before cutting starts.',
  },
  {
    key: 'dwellAfterCoolantOff',
    kind: 'boolean',
    label: 'Dwell after coolant off',
    description: 'Coolant needs a pause after the final M9 before moving on.',
  },
  {
    key: 'tapCycleOptionalStop',
    kind: 'boolean',
    label: 'Operator stop before tapping',
    description:
      'Every tapping cycle is preceded by an optional stop so the operator can check.',
  },
  {
    key: 'maxSpindleSpeed',
    kind: 'number',
    label: 'Maximum spindle speed',
    min: 1,
    integer: true,
    unit: 'rpm',
    description:
      'Fastest the spindle can turn. A program commanding more is refused rather than posted.',
  },
  {
    key: 'toolChanger',
    kind: 'enum',
    label: 'Tool changer',
    values: ['carousel', 'umbrella', 'manual'],
    description:
      'How tools are exchanged. Recorded for the machine record; no post branches on it yet.',
  },
] as const satisfies readonly MachineFeatureSpec[];

type Specs = (typeof MACHINE_FEATURE_SPECS)[number];

type ValueOf<S> = S extends { kind: 'boolean' }
  ? boolean
  : S extends { kind: 'number' }
    ? number
    : S extends { kind: 'enum'; values: readonly (infer V)[] }
      ? V
      : never;

/**
 * Physical properties of one machine, as a machinist would describe it.
 *
 * Derived from `MACHINE_FEATURE_SPECS` rather than written out, so the type
 * and the validation cannot drift apart.
 *
 * The test for belonging here is whether someone standing at the machine
 * could point at the thing. How the G-code *text* is written is not a machine
 * property, even though it differs between shops; that is a dialect trait —
 * see `MachineProfile.dialect` and `posts/siemens-828d/dialect.ts`.
 */
export type MachineProfileFeatures = {
  [S in Specs as S['key']]?: ValueOf<S>;
};

/**
 * Keys that were machine features before dialects existed.
 *
 * Rejected by name rather than swept up by the unknown-key check, because
 * "this moved, and here is where" is a fix someone can act on, while
 * "unrecognised" is a puzzle.
 */
const DIALECT_FEATURE_KEYS = [
  'drillApproachZBeforeCoolant',
  'retainCoolantAcrossJobs',
  'cancelAirCoolantSchedule',
  'lineFeedFromChangeFlag',
  'trackArcFeedRate',
  'inlineFeedRateMode',
  'compactCoordinates',
  'mainToolListComments',
  'forceInitialApproachPosition',
  'toolMeasurementProgramDeferred',
] as const;

const SPECS_BY_KEY = new Map<string, MachineFeatureSpec>(
  MACHINE_FEATURE_SPECS.map((spec) => [spec.key, spec]),
);

/**
 * Validates a `features` block against the table.
 *
 * Unknown keys are an error. A key nobody reads is a setting the author
 * believes is in force and is not, which on this system means G-code that
 * differs from what the profile describes.
 */
export function parseMachineFeatures(
  value: unknown,
  source: string,
): MachineProfileFeatures | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${source}.features must be a JSON object.`);
  }

  const moved = DIALECT_FEATURE_KEYS.filter((key) => key in value);
  if (moved.length > 0) {
    throw new Error(
      `${source}.features contains dialect traits that are no longer machine ` +
        `properties: ${moved.join(', ')}. Remove them and set a top-level ` +
        `"dialect" instead (for legacy PoyaKar output, "poyakar-1160l").`,
    );
  }

  const unknown = Object.keys(value).filter((key) => !SPECS_BY_KEY.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `${source}.features has unrecognised properties: ${unknown.join(', ')}. ` +
        `Known properties: ${[...SPECS_BY_KEY.keys()].join(', ')}.`,
    );
  }

  const features: Record<string, unknown> = {};
  for (const spec of MACHINE_FEATURE_SPECS) {
    const raw = value[spec.key];
    if (raw === undefined) continue;
    features[spec.key] = parseFeatureValue(spec, raw, source);
  }

  return features as MachineProfileFeatures;
}

/** The table in a form a UI can render without importing any of this. */
export function machineFeatureSchema(): MachineFeatureSpec[] {
  return MACHINE_FEATURE_SPECS.map((spec) => ({ ...spec }));
}

function parseFeatureValue(
  spec: MachineFeatureSpec,
  raw: unknown,
  source: string,
): boolean | number | string {
  const key = `${source}.features.${spec.key}`;

  if (spec.kind === 'boolean') {
    if (typeof raw !== 'boolean') {
      throw new Error(`${key} must be a boolean.`);
    }
    return raw;
  }

  if (spec.kind === 'enum') {
    if (typeof raw !== 'string' || !spec.values.includes(raw)) {
      throw new Error(`${key} must be one of: ${spec.values.join(', ')}.`);
    }
    return raw;
  }

  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${key} must be a finite number.`);
  }
  if (spec.integer === true && !Number.isInteger(raw)) {
    throw new Error(`${key} must be a whole number.`);
  }
  if (spec.min !== undefined && raw < spec.min) {
    throw new Error(`${key} must be at least ${spec.min}.`);
  }
  if (spec.max !== undefined && raw > spec.max) {
    throw new Error(`${key} must be at most ${spec.max}.`);
  }
  return raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
