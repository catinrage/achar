import type { EventConsumer } from './event-consumer';
import { runConsumer } from './event-consumer';
import type { EventFields } from './event-fields';
import { fieldsOf, readBoolean, readNumber, readString } from './event-fields';
import type { EventData } from './parser';
import type { SetupTiming, ToolTiming } from './timing';
import { createTimingConsumer, formatDurationSeconds } from './timing';
import type { ToolCatalogEntry } from './tool-catalog';
import { createToolCatalogConsumer } from './tool-catalog';

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

/**
 * The profile as a fold, so a caller that also needs something else from the
 * same trace can drive both over one pass instead of walking twice.
 */
export function createProductProfileConsumer(): EventConsumer<ProductProfile> {
  // Four folds, one pass. Walking `events` again would be silently empty if a
  // caller handed in a generator — see event-consumer.ts.
  const partConsumer = createPartConsumer();
  const timingConsumer = createTimingConsumer();
  const catalogConsumer = createToolCatalogConsumer();
  const metadataConsumer = createSetupMetadataConsumer();
  const consumers = [
    partConsumer,
    timingConsumer,
    catalogConsumer,
    metadataConsumer,
  ];

  const push = (event: EventData): void => {
    for (const consumer of consumers) consumer.push(event);
  };

  const finish = (): ProductProfile => {
    const timing = timingConsumer.finish();
    const catalog = catalogConsumer.finish();
    const metadata = metadataConsumer.finish();

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
      part: partConsumer.finish(),
      setups,
      tools: mergeToolTiming(catalog, timing.tools),
      totals: { seconds: timing.seconds, duration: timing.duration },
      eventCount: partConsumer.count,
      diagnostics: collectDiagnostics(timing, catalog, setups, metadata),
    };
  };

  return { push, finish };
}

export function extractProductProfile(
  events: Iterable<EventData>,
): ProductProfile {
  return runConsumer(createProductProfileConsumer(), events);
}

/**
 * Keeps the first `start_of_file` and counts everything, so the part summary
 * and `eventCount` both come out of the same single pass.
 */
function createPartConsumer(): EventConsumer<ProductPart> & { count: number } {
  let startOfFile: EventData | undefined;
  const consumer = {
    count: 0,
    push(event: EventData): void {
      consumer.count++;
      if (!startOfFile && event._eventName === 'StartOfFile') {
        startOfFile = event;
      }
    },
    finish: (): ProductPart =>
      startOfFile ? describePart(fieldsOf(startOfFile)) : {},
  };
  return consumer;
}

function describePart(data: EventFields): ProductPart {
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
function createSetupMetadataConsumer(): EventConsumer<
  (SetupMetadata | undefined)[]
> {
  const metadata: (SetupMetadata | undefined)[] = [];
  let opened = false;

  const push = (event: EventData): void => {
    if (event._eventName === 'Setup') {
      const data = fieldsOf(event);
      metadata.push({
        fixtureName: readString(data, 'fixture_name'),
        partHomeNumber: readNumber(data, 'part_home_number'),
      });
      opened = true;
      return;
    }
    if (event._eventName === 'StartOfJob' && !opened) {
      metadata.push(undefined);
      opened = true;
    }
  };

  return { push, finish: () => metadata };
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

/**
 * When the trace was posted, as the post itself stamped it.
 *
 * SolidCAM puts no timestamp in any event: the only record of when a trace was
 * produced is the `; Date` comment the GPP writes into its own output near the
 * top of the file. That makes this a deliberate read of an emitted line — the
 * same exception the parser already makes for cycle arguments — rather than
 * event data.
 *
 * It answers one question the rest of the analysis cannot: whether an uploaded
 * trace still reflects the CAM project. A trace posted before an operation was
 * added describes the project as it was, and reports a setup count that is
 * correct for the file and wrong for the part.
 */
export interface TracePostedAt {
  /** Exactly as the post wrote it, e.g. `AUG-31-2026-9:25:37AM`. */
  raw: string;
  /**
   * Local-time ISO 8601, when the stamp parsed. The stamp carries no zone —
   * it is the posting machine's wall clock — so none is implied here either.
   */
  iso?: string;
}

const POST_DATE_LINE = /^\s*>?\s*N?\d*\s*;\s*Date\s*:\s*(\S.*?)\s*$/im;
const POST_DATE_STAMP =
  /^([A-Z]{3})-\s*(\d{1,2})-(\d{4})-(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i;
const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

/**
 * Reads the post timestamp from the head of a trace.
 *
 * Only the head: the stamp sits in the program header, within the first few
 * dozen lines, and scanning a 60 MB trace for it would cost more than the
 * whole analysis. A trace without one simply has no stamp to report.
 */
export function readTracePostedAt(
  source: string,
  headBytes = 8192,
): TracePostedAt | undefined {
  const match = POST_DATE_LINE.exec(source.slice(0, headBytes));
  const raw = match?.[1];
  if (raw === undefined) return undefined;

  const stamp = POST_DATE_STAMP.exec(raw);
  if (!stamp) return { raw };

  const month = MONTHS.indexOf(stamp[1].toUpperCase()) + 1;
  if (month === 0) return { raw };

  let hour = Number(stamp[4]) % 12;
  if (stamp[7].toUpperCase() === 'PM') hour += 12;

  const pad = (value: number | string, width = 2): string =>
    String(value).padStart(width, '0');

  return {
    raw,
    iso: `${stamp[3]}-${pad(month)}-${pad(stamp[2])}T${pad(hour)}:${stamp[5]}:${stamp[6]}`,
  };
}
