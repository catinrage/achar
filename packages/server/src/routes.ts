import type { CompareOptions } from '@achar/core';
import {
  formatVmidSummary,
  lintPostSource,
  listBuiltinPosts,
  parseVmid,
} from '@achar/core';
import type { RouteContext } from './context';
import { badRequest } from './errors';
import type { RouteResponse } from './http';
import { json, plainText } from './http';
import type { Route } from './kernel';
import type { RequestBody } from './request';

/**
 * The route table and its handlers.
 *
 * Handlers stay thin on purpose: decode, call a service, shape the response.
 * Anything that looks like machining logic belongs in core, where the CLI and
 * MCP server can reach it too.
 *
 * Routes marked `gated` read a trace. Their body is spooled to scratch by the
 * kernel and the work is dispatched to a worker thread — nothing on this table
 * parses on the HTTP thread, because a large trace holds it for many seconds
 * and every other caller waits, `/health` included.
 *
 * Everything here is stateless: inputs arrive in the request, results leave in
 * the response, and nothing survives it.
 */

/** Hard ceiling on `/v1/trace/parse` page size. */
const MAX_PARSE_LIMIT = 5000;
const DEFAULT_PARSE_LIMIT = 500;

/** What the worker returns in place of output when diagnostics stopped it. */
interface Refusal {
  __refused: true;
  eventCount: number;
  durationMs: number;
  diagnostics: unknown;
}

function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && '__refused' in value;
}

/**
 * Applies the rule that error-severity diagnostics stop generation. The caller
 * still gets everything extracted so far, so a bad machine profile is
 * diagnosable without a second round trip.
 */
function respond(value: unknown, okStatus = 200): RouteResponse {
  if (isRefusal(value)) {
    const { __refused, ...body } = value;
    return json(body, 422);
  }
  return json(value, okStatus);
}

/** The documents and options a gated route hands to a worker. */
function traceTask(context: RouteContext) {
  const { body } = context;
  return {
    tracePath: context.trace?.path ?? '',
    vmid: body.part('vmid'),
    machineProfile: body.part('machineProfile'),
    postId: body.option('postId'),
    programName: body.option('programName'),
  };
}

export const v1Routes: Route[] = [
  {
    method: 'GET',
    path: '/health',
    gated: false,
    handle: ({ version, uptimeSeconds, services }) =>
      json({
        status: 'ok',
        version,
        uptimeSeconds,
        // Surfaced so a supervisor can tell "healthy but saturated" from
        // "healthy and idle" without reading the access log.
        parsing: services.pool.inFlight,
        queued: services.pool.queued,
      }),
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
          dialects: post.dialects,
        })),
      }),
  },
  {
    method: 'POST',
    path: '/v1/trace/profile',
    gated: true,
    handle: async (context) => {
      const profile = await context.services.pool.tryRun<{
        diagnostics: Array<{ severity: string }>;
      }>({ op: 'profile', ...traceTask(context) });
      return json(
        profile,
        profile.diagnostics.some((entry) => entry.severity === 'error')
          ? 422
          : 200,
      );
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/timing',
    gated: true,
    handle: async (context) =>
      json(
        await context.services.pool.tryRun({
          op: 'timing',
          ...traceTask(context),
        }),
      ),
  },
  {
    method: 'POST',
    path: '/v1/trace/validate',
    gated: true,
    handle: async (context) => {
      const result = await context.services.pool.tryRun<{
        diagnostics: Array<{ severity: string }>;
      }>({ op: 'validate', ...traceTask(context) });
      return json(
        result,
        result.diagnostics.some((entry) => entry.severity === 'error')
          ? 422
          : 200,
      );
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/generate',
    gated: true,
    handle: async (context) =>
      respond(
        await context.services.pool.tryRun({
          op: 'generate',
          ...traceTask(context),
        }),
      ),
  },
  {
    method: 'POST',
    path: '/v1/trace/explain',
    gated: true,
    handle: async (context) => {
      const result = await context.services.pool.tryRun<
        Refusal | { text: string }
      >({
        op: 'explain',
        ...traceTask(context),
        file: context.body.option('file'),
        event: context.body.option('event'),
      });
      return isRefusal(result) ? respond(result) : plainText(result.text);
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/parity',
    gated: true,
    handle: async (context) => {
      const reference = context.body.fileList('reference');
      if (reference.length === 0) {
        throw badRequest(
          "At least one 'reference' file part is required to compare against.",
        );
      }

      return respond(
        await context.services.pool.tryRun({
          op: 'parity',
          ...traceTask(context),
          reference,
          compare: compareOptions(context.body),
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/v1/trace/parse',
    gated: true,
    handle: async (context) => {
      // A single trace can hold 1.6M events. Paging is mandatory: serializing
      // the whole array would bury both this process and the caller.
      const offset = context.body.integerOption('offset', {
        fallback: 0,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
      });
      const limit = context.body.integerOption('limit', {
        fallback: DEFAULT_PARSE_LIMIT,
        min: 1,
        max: MAX_PARSE_LIMIT,
      });

      return json(
        await context.services.pool.tryRun({
          op: 'parse',
          ...traceTask(context),
          event: context.body.option('event'),
          offset,
          limit,
        }),
      );
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
