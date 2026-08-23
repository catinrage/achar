import type {
  AcharDiagnostic,
  BuiltInPost,
  EventData,
  MachineProfile,
  Program,
  VmidDefinition,
} from '@achar/core';
import {
  generatePostProgram,
  Parser,
  parseMachineProfile,
  parseVmid,
  resolveBuiltinPost,
  validateMachineProfileCompatibility,
  validateTraceAgainstVmid,
} from '@achar/core';
import { badRequest, parseFailed } from './errors';
import type { RequestBody } from './request';

/**
 * Turns request parts into the content-based inputs `@achar/core` expects.
 *
 * Everything here is content in, values out — nothing touches the filesystem,
 * and no error carries a server-side path. The `source` labels handed to core
 * parsers ('machineProfile') are deliberately generic for the same reason.
 *
 * Each entry point comes in two shapes: one reading a {@link RequestBody},
 * used by the `/v1` routes, and one taking plain values, used by the parse
 * worker — which receives its inputs over a thread boundary and has no
 * request to read.
 */

const DEFAULT_POST_ID = 'siemens-828d';
const FALLBACK_PROGRAM_NAME = 'PROGRAM';

/**
 * Longest accepted line in a posted trace.
 *
 * The parser's key-value regex backtracks quadratically on a long run of word
 * characters containing no `:` — measured at 105 ms for one 8 KB line, 1.7 s
 * for 32 KB, 6.6 s for 64 KB. The longest line in any of this repo's seven
 * fixtures is 877 bytes, so 8 KB leaves ~9x headroom over real SolidCAM output
 * while keeping a single pathological line under ~100 ms.
 *
 * This is a boundary guard, not a cure: the quadratic parse itself is a core
 * defect and is why this port must stay on a trusted network.
 */
const MAX_TRACE_LINE_BYTES = 8 * 1024;

export interface TraceInputs {
  events: EventData[];
  vmid?: VmidDefinition;
  machineProfile?: MachineProfile;
  /** VMID and machine-profile findings, in `AcharDiagnostic` shape. */
  diagnostics: AcharDiagnostic[];
  durationMs: number;
}

/** The documents a trace operation needs, already read into memory. */
export interface TraceDocuments {
  trace: string;
  vmid?: string;
  machineProfile?: string;
}

/** The non-document options that shape generated output. */
export interface ProgramOptions {
  postId?: string;
  programName?: string;
}

export function parseTrace(source: string): EventData[] {
  assertLineLengths(source);

  let events: EventData[];
  try {
    events = new Parser(source).parse();
  } catch (error) {
    throw parseFailed(error);
  }

  // The parser is deliberately lenient: text with no `@event` markers yields
  // an empty list rather than an error. Over HTTP that would turn "the caller
  // posted the wrong file" into a valid-looking zero-duration result, so an
  // empty parse is treated as a failed one. Every real Trace 5 file opens with
  // `@start_of_file`.
  if (events.length === 0) {
    throw parseFailed(
      new Error('no Trace 5 events were found; is this a Trace 5 .MPF file?'),
    );
  }

  return events;
}

/**
 * Rejects a trace containing a line long enough to trigger the parser's
 * quadratic backtracking. Scans without splitting, so checking the limit
 * costs one pass and no extra allocation.
 */
function assertLineLengths(source: string): void {
  let lineStart = 0;

  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart);
    const end = newline === -1 ? source.length : newline;
    if (end - lineStart > MAX_TRACE_LINE_BYTES) {
      throw badRequest(
        `Line ${countLines(source, lineStart)} exceeds the ${MAX_TRACE_LINE_BYTES} character limit; this does not look like SolidCAM Trace 5 output.`,
      );
    }
    if (newline === -1) return;
    lineStart = newline + 1;
  }
}

function countLines(source: string, upTo: number): number {
  let lines = 1;
  for (let index = source.indexOf('\n'); index !== -1 && index < upTo; ) {
    lines += 1;
    index = source.indexOf('\n', index + 1);
  }
  return lines;
}

/** Parses the trace plus whichever optional companions were supplied. */
export function loadTraceInputs(body: RequestBody): TraceInputs {
  return loadTraceInputsFrom({
    trace: body.document('trace'),
    vmid: body.part('vmid'),
    machineProfile: body.part('machineProfile'),
  });
}

/** {@link loadTraceInputs} for a caller that already holds the documents. */
export function loadTraceInputsFrom(documents: TraceDocuments): TraceInputs {
  const startedAt = performance.now();
  const events = parseTrace(documents.trace);
  const vmid = readVmid(documents.vmid);
  const machineProfile = readMachineProfile(documents.machineProfile);

  return {
    events,
    vmid,
    machineProfile,
    diagnostics: [
      ...(vmid ? validateTraceAgainstVmid(events, vmid) : []),
      ...validateMachineProfileCompatibility(machineProfile, events, vmid),
    ],
    durationMs: performance.now() - startedAt,
  };
}

function readVmid(source: string | undefined): VmidDefinition | undefined {
  if (source === undefined) return undefined;

  try {
    return parseVmid(source);
  } catch (error) {
    throw badRequest(
      `The 'vmid' part could not be parsed: ${messageOf(error)}`,
    );
  }
}

function readMachineProfile(
  source: string | undefined,
): MachineProfile | undefined {
  if (source === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw badRequest("The 'machineProfile' part is not valid JSON.");
  }

  try {
    return parseMachineProfile(parsed, 'machineProfile');
  } catch (error) {
    throw badRequest(messageOf(error));
  }
}

function resolvePost(postId: string | undefined): BuiltInPost {
  const requested = postId ?? DEFAULT_POST_ID;
  const post = resolveBuiltinPost(requested);
  if (!post) {
    throw badRequest(
      `Unknown post '${requested}'. Call GET /v1/posts for the available ids.`,
    );
  }
  return post;
}

/**
 * The program name for generated files. A stateless caller has no path to
 * derive one from, so an unset option falls back to the trace's own
 * `part_name` before the last-resort constant.
 */
function resolveProgramName(
  requested: string | undefined,
  events: EventData[],
): string {
  if (requested) return requested;

  const startOfFile = events.find(
    (event) => event._eventName === 'StartOfFile',
  );
  const partName = startOfFile?.part_name;
  return typeof partName === 'string' && partName.trim().length > 0
    ? partName.trim()
    : FALLBACK_PROGRAM_NAME;
}

/** Builds and runs the post program for the given inputs. */
export function buildProgram(
  body: RequestBody,
  inputs: TraceInputs,
): { program: Program; programName: string } {
  return buildProgramFrom(
    { postId: body.option('postId'), programName: body.option('programName') },
    inputs,
  );
}

/** {@link buildProgram} for a caller that already holds the options. */
export function buildProgramFrom(
  options: ProgramOptions,
  inputs: TraceInputs,
): { program: Program; programName: string } {
  const post = resolvePost(options.postId);
  const programName = resolveProgramName(options.programName, inputs.events);
  const program = generatePostProgram(inputs.events, programName, (target) =>
    post.registerPost(target, { machineProfile: inputs.machineProfile }),
  );

  return { program, programName };
}

export function hasErrorDiagnostics(diagnostics: AcharDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
