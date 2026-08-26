import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { isAuthorized } from './auth';
import type { RouteContext, ServerServices, SpooledTrace } from './context';
import {
  HttpError,
  internalError,
  messageOf,
  methodNotAllowed,
  notFound,
  unauthorized,
} from './errors';
import type { RouteResponse } from './http';
import { byteLength, json, toResponse } from './http';
import { spoolToFile } from './parse/spool';
import { RequestBody, readRequestBody } from './request';

/**
 * The HTTP kernel: routing, decoding, limits, authentication, error mapping.
 *
 * Deliberately knows nothing about what it serves. `@achar/server` gives it
 * the stateless `/v1` table; the workshop gives it that table plus its
 * own, along with a fallback for serving a web UI. Keeping the two apart is
 * what lets `/v1` remain a package with no database and no volume.
 */

export interface Route<Services extends ServerServices = ServerServices> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** May contain `:name` segments, captured into `context.params`. */
  path: string;
  /** Reads a trace: its body is spooled and the work goes to a worker. */
  gated: boolean;
  /**
   * The handler reads `context.request` itself. The router leaves the body
   * untouched so an upload can be streamed to disk instead of buffered.
   */
  streaming?: boolean;
  /*
   * A method signature, not a property holding a function. TypeScript checks
   * method parameters bivariantly, which is what lets a table written against
   * the base `ServerServices` be served by a kernel running a widened one —
   * The workshop mounts `v1Routes` unchanged beside its own.
   */
  handle(
    context: RouteContext<Services>,
  ): Promise<RouteResponse> | RouteResponse;
}

export interface KernelOptions<Services extends ServerServices> {
  routes: Array<Route<Services>>;
  services: Services;
  version: string;
  /** Defaults to loopback. Binding publicly must be a deliberate choice. */
  host: string;
  port: number;
  /** When set, every `/v1/*` route requires `Authorization: Bearer <token>`. */
  token: string | undefined;
  /**
   * Answers a `GET` that matched no route — the web UI's assets and pages.
   * Never consulted for an API prefix; see {@link isApiPath}.
   */
  onUnmatched?: (url: URL) => Promise<RouteResponse | undefined>;
}

export interface RunningServer {
  port: number;
  stop: () => Promise<void>;
}

/**
 * How much larger the runtime's body cap is than ours.
 *
 * Bun enforces `maxRequestBodySize` itself and answers an over-limit request
 * with a bodyless 413, before any route of ours runs. Giving it headroom means
 * a body that merely overshoots the configured limit reaches our own checks
 * and gets the documented `{ error }` JSON instead.
 */
const BODY_LIMIT_HEADROOM = 2;
const MULTIPART = 'multipart/form-data';

/**
 * Methods whose request body the router decodes.
 *
 * `PATCH` belongs here as much as `POST` does: leaving it out does not fail,
 * it silently hands the handler an empty body, so an edit appears to succeed
 * while changing nothing.
 */
const CARRIES_A_BODY = new Set(['POST', 'PATCH', 'PUT']);

export function startKernel<Services extends ServerServices>(
  options: KernelOptions<Services>,
): RunningServer {
  const startedAt = Date.now();
  mkdirSync(options.services.scratchDir, { recursive: true });

  const server = Bun.serve({
    port: options.port,
    hostname: options.host,
    // See BODY_LIMIT_HEADROOM. This also stays the only bound available for
    // chunked bodies, which declare no length and so cannot be checked up
    // front.
    maxRequestBodySize: options.services.maxBodyBytes * BODY_LIMIT_HEADROOM,
    // A queued upload can wait behind a long parse; the default idle timeout
    // would drop it while it was legitimately waiting.
    idleTimeout: 255,
    fetch: (request) => handleRequest(request, options, startedAt),
  });

  return {
    // Always a TCP port here; the undefined case is Bun's unix-socket mode.
    port: server.port ?? 0,
    stop: async () => {
      await server.stop(true);
    },
  };
}

async function handleRequest<Services extends ServerServices>(
  request: Request,
  options: KernelOptions<Services>,
  startedAt: number,
): Promise<Response> {
  const begunAt = performance.now();
  const url = new URL(request.url);
  const requestBytes = Number(request.headers.get('content-length') ?? '0');

  const result = await route(request, url, options, startedAt);
  await discardUnreadBody(request);
  logRequest({
    method: request.method,
    path: url.pathname,
    status: result.status,
    requestBytes: Number.isFinite(requestBytes) ? requestBytes : 0,
    responseBytes: byteLength(result.body),
    durationMs: performance.now() - begunAt,
  });

  return toResponse(result);
}

async function route<Services extends ServerServices>(
  request: Request,
  url: URL,
  options: KernelOptions<Services>,
  startedAt: number,
): Promise<RouteResponse> {
  try {
    // Authenticated before routing, so an unauthorized caller cannot probe
    // which `/v1` routes exist. `/health` stays open so a supervisor can
    // check a token-protected server without holding the token.
    if (options.token && url.pathname.startsWith('/v1/')) {
      if (!isAuthorized(request, options.token)) throw unauthorized();
    }

    const matched = matchRoute(options.routes, request.method, url.pathname);
    if (!matched) {
      // An unmatched GET may still be a page or an asset of a UI — but never
      // under an API prefix. Letting `/v1/typo` fall through would answer a
      // broken API call with HTML and a 200, which is far harder to diagnose
      // than the 404 it should be.
      const asset =
        request.method === 'GET' && !isApiPath(url.pathname)
          ? await options.onUnmatched?.(url)
          : undefined;
      if (asset) return asset;
      throw notFound();
    }

    return await invoke(matched, request, url, options, startedAt);
  } catch (error) {
    return errorResponse(error);
  }
}

interface MatchedRoute<Services extends ServerServices> {
  route: Route<Services>;
  params: Record<string, string>;
}

/**
 * Matches a path against the table, capturing `:name` segments.
 *
 * The pattern with the fewest captures wins, so a literal route can be added
 * beside a parameterised one without their order becoming load-bearing.
 */
function matchRoute<Services extends ServerServices>(
  routes: Array<Route<Services>>,
  method: string,
  pathname: string,
): MatchedRoute<Services> | undefined {
  const requested = normalizePath(pathname).split('/');
  const candidates: Array<MatchedRoute<Services>> = [];
  let pathExists = false;

  for (const route of routes) {
    const pattern = route.path.split('/');
    if (pattern.length !== requested.length) continue;

    const params: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const segment = pattern[index] ?? '';
      const value = requested[index] ?? '';
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(value);
        continue;
      }
      if (segment !== value) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    pathExists = true;
    if (route.method === method) candidates.push({ route, params });
  }

  if (candidates.length > 0) {
    candidates.sort(
      (a, b) => Object.keys(a.params).length - Object.keys(b.params).length,
    );
    return candidates[0];
  }
  if (pathExists) {
    throw methodNotAllowed(allowedMethodsFor(routes, requested));
  }
  return undefined;
}

function allowedMethodsFor<Services extends ServerServices>(
  routes: Array<Route<Services>>,
  requested: string[],
): string[] {
  const allowed = new Set<string>();
  for (const route of routes) {
    const pattern = route.path.split('/');
    if (pattern.length !== requested.length) continue;
    const matches = pattern.every(
      (segment, index) =>
        segment.startsWith(':') || segment === requested[index],
    );
    if (matches) allowed.add(route.method);
  }
  return [...allowed];
}

/** Prefixes reserved for JSON APIs, which never serve a UI. */
function isApiPath(pathname: string): boolean {
  return (
    pathname === '/health' ||
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/api/')
  );
}

/** Tolerates a trailing slash so `/v1/posts/` is not a 404. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
}

function isMultipart(request: Request): boolean {
  return (request.headers.get('content-type') ?? '')
    .toLowerCase()
    .includes(MULTIPART);
}

async function invoke<Services extends ServerServices>(
  matched: MatchedRoute<Services>,
  request: Request,
  url: URL,
  options: KernelOptions<Services>,
  startedAt: number,
): Promise<RouteResponse> {
  const { services } = options;
  const { route: matchedRoute, params } = matched;
  let body: RequestBody;
  let trace: SpooledTrace | undefined;

  if (matchedRoute.streaming || !CARRIES_A_BODY.has(matchedRoute.method)) {
    // The handler reads the request itself, or there is nothing to read.
    body = emptyBody(url);
  } else if (matchedRoute.gated && !isMultipart(request)) {
    // The documented fast path: the whole body is the trace. It goes to disk
    // as it arrives and never becomes a string in this process, so a large
    // upload costs scratch space rather than the heap. Options come from the
    // query string, which is what that request shape specifies.
    body = emptyBody(url);
    trace = await spoolStream(request, services);
  } else {
    body = await readRequestBody(request, url, services.maxBodyBytes);
    if (matchedRoute.gated) trace = await spoolBuffered(body, services);
  }

  try {
    return await matchedRoute.handle({
      request,
      url,
      params,
      body,
      trace,
      services,
      version: options.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  } finally {
    if (trace?.ephemeral) {
      await Bun.file(trace.path)
        .delete()
        .catch(() => {
          // Best effort. A failure here is not worth failing an answered
          // request over, and the file is in scratch either way.
        });
    }
  }
}

/** A scratch path for one request's trace. */
function scratchPath(services: ServerServices): string {
  return path.join(services.scratchDir, `${Bun.randomUUIDv7()}.MPF`);
}

/** Streams a raw-body trace to scratch without buffering it. */
async function spoolStream(
  request: Request,
  services: ServerServices,
): Promise<SpooledTrace> {
  const upload = await spoolToFile(
    request,
    scratchPath(services),
    services.maxBodyBytes,
  );
  return { ...upload, name: 'trace.MPF', ephemeral: true };
}

/**
 * Writes out the `trace` part of an already-buffered multipart body.
 *
 * Multipart parts cannot be named until the whole body has been read, so this
 * shape pays for the copy either way. It is the CLI's request shape, not the
 * one carrying hundreds of megabytes several times a day.
 */
async function spoolBuffered(
  body: RequestBody,
  services: ServerServices,
): Promise<SpooledTrace> {
  const source = body.document('trace');
  const destination = scratchPath(services);
  await Bun.write(destination, source);
  return {
    path: destination,
    bytes: Buffer.byteLength(source, 'utf-8'),
    sha256: '',
    name: 'trace.MPF',
    ephemeral: true,
  };
}

function emptyBody(url: URL): RequestBody {
  return new RequestBody({
    fields: new Map(),
    files: new Map(),
    query: url.searchParams,
  });
}

/**
 * Drops any request body the handler never read.
 *
 * Every early rejection — `503 busy`, `413 body-too-large`, `401`, `404` —
 * answers before consuming the body, by design: refusing a large upload
 * without buffering it is the whole point of checking `Content-Length` first.
 * Cancelling the leftover stream is the matching half of that, so a client
 * mid-upload is released rather than left writing into a socket no one reads.
 */
async function discardUnreadBody(request: Request): Promise<void> {
  if (!request.body || request.bodyUsed) return;

  try {
    await request.body.cancel();
  } catch {
    // The peer may have gone already; nothing left to release.
  }
}

function errorResponse(error: unknown): RouteResponse {
  if (error instanceof HttpError) {
    return {
      ...json(error.toBody(), error.status),
      headers: error.headers,
    };
  }

  // Nothing unexpected leaves the box: the caller gets a generic message and
  // the detail stays in the server's own log.
  console.error(`[achar] unhandled error: ${messageOf(error)}`);
  const fallback = internalError();
  return json(fallback.toBody(), fallback.status);
}

interface RequestLog {
  method: string;
  path: string;
  status: number;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
}

function logRequest(entry: RequestLog): void {
  console.log(
    `${entry.method} ${entry.path} ${entry.status} req=${entry.requestBytes}b res=${entry.responseBytes}b ${entry.durationMs.toFixed(1)}ms`,
  );
}
