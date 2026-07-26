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
  const startedAt = performance.now();
  const events = parseTrace(body.document('trace'));
  const vmid = readVmid(body);
  const machineProfile = readMachineProfile(body);

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

function readVmid(body: RequestBody): VmidDefinition | undefined {
  const source = body.part('vmid');
  if (source === undefined) return undefined;

  try {
    return parseVmid(source);
  } catch (error) {
    throw badRequest(
      `The 'vmid' part could not be parsed: ${messageOf(error)}`,
    );
  }
}

function readMachineProfile(body: RequestBody): MachineProfile | undefined {
  const source = body.part('machineProfile');
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

function resolvePost(body: RequestBody): BuiltInPost {
  const postId = body.option('postId') ?? DEFAULT_POST_ID;
  const post = resolveBuiltinPost(postId);
  if (!post) {
    throw badRequest(
      `Unknown post '${postId}'. Call GET /v1/posts for the available ids.`,
    );
  }
  return post;
}

/**
 * The program name for generated files. A stateless caller has no path to
 * derive one from, so an unset option falls back to the trace's own
 * `part_name` before the last-resort constant.
 */
function resolveProgramName(body: RequestBody, events: EventData[]): string {
  const requested = body.option('programName');
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
  const post = resolvePost(body);
  const programName = resolveProgramName(body, inputs.events);
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
