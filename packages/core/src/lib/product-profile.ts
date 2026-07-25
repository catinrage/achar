import type { EventFields } from './event-fields';
import { fieldsOf, readBoolean, readNumber, readString } from './event-fields';
import type { EventData } from './parser';
import type { SetupTiming, ToolTiming } from './timing';
import { extractTimingReport, formatDurationSeconds } from './timing';
import type { ToolCatalogEntry } from './tool-catalog';
import { extractToolCatalog } from './tool-catalog';

/**
 * Whole-part summary of a Trace 5 program.
 *
 * Composes `start_of_file` metadata, the timing report, and the tool catalog
 * into one machining-facts document that a downstream system can consume
 * without knowing anything about Trace 5. It is a pure function of the parsed
 * events: no I/O, and the event array itself is never included — a 67 MB trace
 * yields well over 200k events.
 *
 * Every SolidCAM string (material, fixture, tool names) is passed through
 * verbatim. Achar does not know what those strings mean to any consumer, so it
 * does not map them onto enums or derive weights from them.
 */

export type ProductProfileDiagnosticCode =
  | 'no-timing-data'
  | 'no-setups'
  | 'empty-setup'
  | 'duplicate-setup-name';

/**
 * Structurally compatible with `AcharDiagnostic` so both can share one list,
 * but declared here to keep `lib/` free of a dependency on `application/`.
 * `code` is the stable identifier — branch on it, never on `message`.
 */
export interface ProductProfileDiagnostic {
  severity: 'warning' | 'error';
  code: ProductProfileDiagnosticCode;
  message: string;
}

export interface ProductDimensions {
  x?: number;
  y?: number;
  z?: number;
}

export interface ProductPart {
  name?: string;
  modelName?: string;
  programNumber?: number;
  /** `imachining_material_name`, verbatim. */
  materialName?: string;
  inchSystem?: boolean;
  stockType?: number;
  stock?: ProductDimensions;
  target?: ProductDimensions;
}

export interface ProductSetup extends SetupTiming {
  /** `fixture_name`, verbatim. */
  fixtureName?: string;
  partHomeNumber?: number;
}

export interface ProductTool extends ToolCatalogEntry {
  seconds: number;
  duration: string;
  jobInstances: number;
}

export interface ProductProfile {
  part: ProductPart;
  setups: ProductSetup[];
  tools: ProductTool[];
  totals: { seconds: number; duration: string };
  eventCount: number;
  diagnostics: ProductProfileDiagnostic[];
}

const NO_TIMING_MESSAGE =
  'This trace carries no machining time estimates. Re-post the part from ' +
  'SolidCAM with time estimation enabled, otherwise every reported duration ' +
  'is zero.';

export function extractProductProfile(events: EventData[]): ProductProfile {
  const timing = extractTimingReport(events);
  const catalog = extractToolCatalog(events);
  const metadata = collectSetupMetadata(events);

  const setups: ProductSetup[] = timing.setups.map((setup, index) => ({
    name: setup.name,
    fixtureName: metadata[index]?.fixtureName,
    partHomeNumber: metadata[index]?.partHomeNumber,
    seconds: setup.seconds,
    duration: setup.duration,
    tools: setup.tools,
    jobs: setup.jobs,
  }));

  return {
    part: extractPart(events),
    setups,
    tools: mergeToolTiming(catalog, timing.tools),
    totals: { seconds: timing.seconds, duration: timing.duration },
    eventCount: events.length,
    diagnostics: collectDiagnostics(timing, catalog, setups, metadata),
  };
}

function extractPart(events: EventData[]): ProductPart {
  const startOfFile = events.find(
    (event) => event._eventName === 'StartOfFile',
  );
  if (!startOfFile) return {};

  const data = fieldsOf(startOfFile);
  return {
    name: readString(data, 'part_name'),
    modelName: readString(data, 'part_model_name'),
    programNumber: readNumber(data, 'program_number'),
    materialName: readString(data, 'imachining_material_name'),
    inchSystem: readBoolean(data, 'inch_system'),
    stockType: readNumber(data, 'stock_type'),
    stock: dimensions(data, 'stock'),
    target: dimensions(data, 'target'),
  };
}

function dimensions(
  data: EventFields,
  prefix: string,
): ProductDimensions | undefined {
  const box = {
    x: readNumber(data, `${prefix}_x`),
    y: readNumber(data, `${prefix}_y`),
    z: readNumber(data, `${prefix}_z`),
  };
  return Object.values(box).some((value) => value !== undefined)
    ? box
    : undefined;
}

interface SetupMetadata {
  fixtureName?: string;
  partHomeNumber?: number;
}

/**
 * Mirrors `extractTimingReport`'s setup sequencing — including the implicit
 * `(no setup)` bucket it opens when jobs precede any `@setup` — so metadata
 * lines up index-for-index with `TimingReport.setups`. Indices holding
 * `undefined` are that implicit bucket, which has no `@setup` event and so no
 * fixture or home number to report.
 */
function collectSetupMetadata(
  events: EventData[],
): (SetupMetadata | undefined)[] {
  const metadata: (SetupMetadata | undefined)[] = [];
  let opened = false;

  for (const event of events) {
    if (event._eventName === 'Setup') {
      const data = fieldsOf(event);
      metadata.push({
        fixtureName: readString(data, 'fixture_name'),
        partHomeNumber: readNumber(data, 'part_home_number'),
      });
      opened = true;
      continue;
    }
    if (event._eventName === 'StartOfJob' && !opened) {
      metadata.push(undefined);
      opened = true;
    }
  }

  return metadata;
}

/**
 * Joins the tool catalog to the whole-program timing roll-up, heaviest first.
 * Tools that never ran keep zero time, and a tool that ran without ever being
 * defined still appears so its machining time is not silently dropped.
 */
function mergeToolTiming(
  catalog: ToolCatalogEntry[],
  timings: ToolTiming[],
): ProductTool[] {
  const byTool = new Map(timings.map((timing) => [timing.tool, timing]));
  const defined = new Set(catalog.map((entry) => entry.toolIdString));

  const merged: ProductTool[] = catalog.map((entry) => {
    const timing = byTool.get(entry.toolIdString);
    return {
      ...entry,
      seconds: timing?.seconds ?? 0,
      duration: timing?.duration ?? formatDurationSeconds(0),
      jobInstances: timing?.jobInstances ?? 0,
    };
  });

  for (const timing of timings) {
    if (defined.has(timing.tool)) continue;
    merged.push({
      toolIdString: timing.tool,
      seconds: timing.seconds,
      duration: timing.duration,
      jobInstances: timing.jobInstances,
    });
  }

  return merged.sort((left, right) => right.seconds - left.seconds);
}

function collectDiagnostics(
  timing: { seconds: number },
  catalog: ToolCatalogEntry[],
  setups: ProductSetup[],
  metadata: (SetupMetadata | undefined)[],
): ProductProfileDiagnostic[] {
  const diagnostics: ProductProfileDiagnostic[] = [];

  // Posting without SolidCAM time estimation produces a structurally valid
  // trace whose every duration is zero. Left unflagged, a consumer would
  // happily build zero-duration production stages from it.
  const declaresToolTime = catalog.some((tool) => tool.declaredWorkTime);
  if (timing.seconds === 0 || (catalog.length > 0 && !declaresToolTime)) {
    diagnostics.push({
      severity: 'error',
      code: 'no-timing-data',
      message: NO_TIMING_MESSAGE,
    });
  }

  if (metadata.every((entry) => entry === undefined)) {
    diagnostics.push({
      severity: 'warning',
      code: 'no-setups',
      message:
        'This trace declares no @setup events, so all machining is reported ' +
        'under a single implicit setup.',
    });
  }

  if (timing.seconds > 0) {
    for (const setup of setups) {
      if (setup.seconds > 0) continue;
      diagnostics.push({
        severity: 'warning',
        code: 'empty-setup',
        message: `Setup '${setup.name}' has no machining time while other setups do.`,
      });
    }
  }

  for (const name of duplicateNames(setups)) {
    diagnostics.push({
      severity: 'warning',
      code: 'duplicate-setup-name',
      message: `Setup name '${name}' appears more than once; setup names are not a reliable key for this trace.`,
    });
  }

  return diagnostics;
}

function duplicateNames(setups: ProductSetup[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const setup of setups) {
    if (seen.has(setup.name)) duplicates.add(setup.name);
    seen.add(setup.name);
  }

  return [...duplicates];
}
