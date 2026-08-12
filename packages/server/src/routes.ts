import type { CompareOptions } from '@achar/core';
import {
  compareGeneratedFiles,
  extractProductProfile,
  extractTimingReport,
  formatVmidSummary,
  lintPostSource,
  listBuiltinPosts,
  parseVmid,
  summarizeCompareResults,
  ValidationError,
} from '@achar/core';
import { badRequest, unprocessableTrace } from './errors';
import type { RouteResponse } from './http';
import { json, plainText } from './http';
import type { TraceInputs } from './inputs';
import {
  buildProgram,
  hasErrorDiagnostics,
  loadTraceInputs,
  parseTrace,
} from './inputs';
import type { RequestBody } from './request';

/**
 * The route table and its handlers.
 *
 * Handlers stay thin on purpose: decode, call `@achar/core`, shape the
 * response. Anything that looks like machining logic belongs in core, where
 * the CLI, MCP server, and desktop app can reach it too.
 *
 * Routes marked `gated` parse a trace and must hold a concurrency slot.
 */

export interface RouteContext {
  body: RequestBody;
  version: string;
  uptimeSeconds: number;
}

export interface Route {
  method: 'GET' | 'POST';
  path: string;
  gated: boolean;
  handle: (context: RouteContext) => RouteResponse;
}

/** Hard ceiling on `/v1/trace/parse` page size. */
const MAX_PARSE_LIMIT = 5000;
const DEFAULT_PARSE_LIMIT = 500;

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/health',
    gated: false,
    handle: ({ version, uptimeSeconds }) =>
      json({ status: 'ok', version, uptimeSeconds }),
  },
  {
    method: 'GET',
    path: '/v1/posts',
    gated: false,
    handle: () =>
      json({
        posts: listBuiltinPosts().map((post) => ({
          id: post.id,
          name: post.name,
          aliases: post.aliases,
        })),
      }),
  },
  {
    method: 'POST',
    path: '/v1/trace/profile',
    gated: true,
    handle: ({ body }) => {
      const profile = analyzeTrace(() =>
        extractProductProfile(parseTrace(body.document('trace'))),
      );
      return json(
        profile,
        hasErrorDiagnostics(profile.diagnostics) ? 422 : 200,
      );
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/timing',
    gated: true,
    handle: ({ body }) =>
      json(
        analyzeTrace(() =>
          extractTimingReport(parseTrace(body.document('trace'))),
        ),
      ),
  },
  {
    method: 'POST',
    path: '/v1/trace/validate',
    gated: true,
    handle: ({ body }) => {
      const inputs = loadTraceInputs(body);
      return json(
        {
          eventCount: inputs.events.length,
          durationMs: inputs.durationMs,
          diagnostics: inputs.diagnostics,
        },
        hasErrorDiagnostics(inputs.diagnostics) ? 422 : 200,
      );
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/generate',
    gated: true,
    handle: ({ body }) => {
      const inputs = loadTraceInputs(body);
      const blocked = refuseOnErrors(inputs);
      if (blocked) return blocked;

      const files = buildProgram(body, inputs).program.generate();
      return json({
        files: files.map((file) => ({
          file: file.file,
          code: file.code,
          bytes: Buffer.byteLength(file.code, 'utf-8'),
          lines: file.code.split(/\r?\n/).length,
        })),
        eventCount: inputs.events.length,
        durationMs: inputs.durationMs,
        diagnostics: inputs.diagnostics,
      });
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/explain',
    gated: true,
    handle: ({ body }) => {
      const inputs = loadTraceInputs(body);
      const blocked = refuseOnErrors(inputs);
      if (blocked) return blocked;

      const { program } = buildProgram(body, inputs);
      return plainText(
        program.explain({
          file: body.option('file'),
          event: body.option('event'),
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/parity',
    gated: true,
    handle: ({ body }) => {
      const reference = body.fileList('reference');
      if (reference.length === 0) {
        throw badRequest(
          "At least one 'reference' file part is required to compare against.",
        );
      }

      const inputs = loadTraceInputs(body);
      const blocked = refuseOnErrors(inputs);
      if (blocked) return blocked;

      const generated = buildProgram(body, inputs).program.generate();
      const results = compareGeneratedFiles(
        generated,
        reference,
        compareOptions(body),
      );
      return json({ results, summary: summarizeCompareResults(results) });
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/parse',
    gated: true,
    handle: ({ body }) => {
      // A single trace can hold 228k events. Paging is mandatory: serializing
      // the whole array would bury both this process and the caller.
      const events = parseTrace(body.document('trace'));
      const name = body.option('event');
      const selected = name
        ? events.filter((event) => event._eventName === name)
        : events;
      const offset = body.integerOption('offset', {
        fallback: 0,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
      });
      const limit = body.integerOption('limit', {
        fallback: DEFAULT_PARSE_LIMIT,
        min: 1,
        max: MAX_PARSE_LIMIT,
      });

      return json({
        events: selected.slice(offset, offset + limit),
        total: selected.length,
        offset,
        limit,
      });
    },
  },
  {
    method: 'POST',
    path: '/v1/vmid/parse',
    gated: false,
    handle: ({ body }) => {
      const source = body.document('vmid');
      let vmid: ReturnType<typeof parseVmid>;
      try {
        vmid = parseVmid(source);
      } catch (error) {
        throw badRequest(
          `The VMID could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return json({ vmid, summary: formatVmidSummary(vmid) });
    },
  },
  {
    method: 'POST',
    path: '/v1/post/lint',
    gated: false,
    handle: ({ body }) =>
      json({
        issues: lintPostSource(body.document('post'), {
          driverFile: booleanOption(body, 'driverFile'),
        }),
      }),
  },
];

/**
 * Runs a core extraction that can reject the trace on its own content.
 *
 * Only `ValidationError` is translated: it is core's way of saying the input
 * failed a stated rule, which for these routes can only be the posted trace.
 * Every other failure stays unhandled and becomes a logged 500, so a genuine
 * server bug is never dressed up as the caller's fault.
 */
function analyzeTrace<T>(analyze: () => T): T {
  try {
    return analyze();
  } catch (error) {
    if (error instanceof ValidationError) throw unprocessableTrace(error);
    throw error;
  }
}

/**
 * Applies `achar-service`'s rule that error-severity diagnostics stop
 * generation. The caller still gets everything extracted so far, so a bad
 * machine profile is diagnosable without a second round trip.
 */
function refuseOnErrors(inputs: TraceInputs): RouteResponse | undefined {
  if (!hasErrorDiagnostics(inputs.diagnostics)) return undefined;

  return json(
    {
      eventCount: inputs.events.length,
      durationMs: inputs.durationMs,
      diagnostics: inputs.diagnostics,
    },
    422,
  );
}

function compareOptions(body: RequestBody): CompareOptions {
  return {
    // Every uploaded reference part was chosen deliberately, so all of them
    // are compared — unlike a reference directory, which holds unrelated files.
    allReferenceFiles: booleanOption(body, 'allReferenceFiles') ?? true,
    ignoreLineNumbers: booleanOption(body, 'ignoreLineNumbers'),
    strict: booleanOption(body, 'strict'),
    normalizeTimestamps: booleanOption(body, 'normalizeTimestamps'),
    maxDiffsPerFile: body.integerOption('maxDiffsPerFile', {
      fallback: 5,
      min: 1,
      max: 1000,
    }),
  };
}

function booleanOption(body: RequestBody, name: string): boolean | undefined {
  const raw = body.option(name);
  if (raw === undefined) return undefined;

  const value = raw.toLowerCase();
  if (['1', 'true', 'yes'].includes(value)) return true;
  if (['0', 'false', 'no'].includes(value)) return false;
  throw badRequest(`'${name}' must be a boolean; received '${raw}'.`);
}
