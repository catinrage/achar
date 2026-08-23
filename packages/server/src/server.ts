import path from 'node:path';
import { Logger } from '@achar/core';
import packageJson from '../package.json' with { type: 'json' };
import { isAuthorized } from './auth';
import type { AppServices, RouteContext, SpooledTrace } from './context';
import { prepareDataPaths } from './data/paths';
import { JobStore } from './data/store';
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
import { WorkerPool } from './jobs/pool';
import { JobRunner } from './jobs/runner';
import { spoolToFile } from './jobs/upload';
import { RequestBody, readRequestBody } from './request';
import type { Route } from './routes';
import { routes } from './routes';
import { serveStatic } from './static';

/**
 * HTTP front end for `@achar/core`.
 *
 * Two surfaces share one process:
 *
 * - `/v1/*` is the stateless API another application consumes. Every request
 *   carries its own inputs and gets its results back in the response — no
 *   workspace root, no server-side paths, nothing retained.
 * - `/api/*` and the static UI are the workshop service, where several people
 *   share one queue and results outlive the request that produced them.
 *
 * Neither parses a trace on this thread. `Parser.parse()` is synchronous and
 * holds the loop for ten to fifteen seconds on a 311 MB file, so all of it
 * happens on worker threads; see {@link WorkerPool}.
 */

export interface AcharServerOptions {
  /** Defaults to 7788. Pass 0 to let the OS choose a free port. */
  port?: number;
  /** Defaults to loopback. Binding publicly must be a deliberate choice. */
  host?: string;
  /** When set, every `/v1/*` route requires `Authorization: Bearer <token>`. */
  token?: string;
  /** Defaults to 384 MB — see {@link DEFAULT_MAX_BODY_BYTES}. */
  maxBodyBytes?: number;
  /** Concurrent trace parses. Defaults to 1; see {@link WorkerPool}. */
  maxConcurrentParses?: number;
  /** Volume root for the job queue. Defaults to `ACHAR_DATA_DIR`. */
  dataDir?: string;
  /** Directory holding the built web UI. */
  webRoot?: string;
  /** Days an uploaded trace is kept before the retention sweep removes it. */
  retentionDays?: number;
  /** Allow the parser's own logging. Off by default; it is very noisy. */
  logs?: boolean;
}

export interface AcharServer {
  port: number;
  stop: () => Promise<void>;
}

const DEFAULT_PORT = 7788;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Default upload ceiling.
 *
 * Sized from what actually parses, not from what a socket can carry. A 311 MB
 * trace peaks around 2 GB of worker memory; 384 MB leaves a little room above
 * the largest real trace seen while keeping the peak inside a 4 GB container.
 * Raising this is a statement about the host's RAM, not about the network.
 */
const DEFAULT_MAX_BODY_BYTES = 384 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_PARSES = 1;
/**
 * How much larger the runtime's body cap is than ours.
 *
 * Bun enforces `maxRequestBodySize` itself and answers an over-limit request
 * with a bodyless 413, before any route of ours runs. Giving it headroom means
 * a body that merely overshoots the configured limit reaches our own checks
 * and gets the documented `{ error }` JSON instead.
 */
const BODY_LIMIT_HEADROOM = 2;

export async function startAcharServer(
  options: AcharServerOptions = {},
): Promise<AcharServer> {
  // The parser emits hundreds of "Unknown event type for validation" warnings
  // per trace. On a server that is noise that would drown the access log.
  if (options.logs !== true) {
    Logger.setGlobalOptions({ enabled: false });
  }

  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const token = options.token?.trim() || undefined;
  const startedAt = Date.now();

  const paths = prepareDataPaths(options.dataDir);
  const store = new JobStore(paths);
  const pool = new WorkerPool({
    size: options.maxConcurrentParses ?? DEFAULT_MAX_CONCURRENT_PARSES,
  });
  const runner = new JobRunner(store, paths, pool, {
    retentionDays: options.retentionDays,
  });

  const services: AppServices = {
    store,
    paths,
    pool,
    runner,
    maxBodyBytes,
    webRoot: options.webRoot ?? resolveBundledWebRoot(),
  };

  runner.recover();
  runner.startRetentionSweep();

  const server = Bun.serve({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.host ?? DEFAULT_HOST,
    // See BODY_LIMIT_HEADROOM. This also stays the only bound available for
    // chunked bodies, which declare no length and so cannot be checked up
    // front.
    maxRequestBodySize: maxBodyBytes * BODY_LIMIT_HEADROOM,
    // A queued upload can wait behind a fifteen-second parse; the default
    // idle timeout would drop it while it was legitimately waiting.
    idleTimeout: 255,
    fetch: (request) => handleRequest(request, { services, token, startedAt }),
  });

  const stop = createStop(server, { runner, pool, store });
  const onSignal = () => {
    void stop();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return {
    // Always a TCP port here; the undefined case is Bun's unix-socket mode.
    port: server.port ?? 0,
    stop: async () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      await stop();
    },
  };
}

interface ServerState {
  services: AppServices;
  token: string | undefined;
  startedAt: number;
}

async function handleRequest(
  request: Request,
  state: ServerState,
): Promise<Response> {
  const begunAt = performance.now();
  const url = new URL(request.url);
  const requestBytes = Number(request.headers.get('content-length') ?? '0');

  const result = await route(request, url, state);
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

async function route(
  request: Request,
  url: URL,
  state: ServerState,
): Promise<RouteResponse> {
  try {
    // Authenticated before routing, so an unauthorized caller cannot probe
    // which `/v1` routes exist. `/health` stays open so a supervisor can
    // check a token-protected server without holding the token.
    //
    // `/api` and the UI are deliberately outside this: the workshop service
    // is a trusted-network deployment with no login, so there is no token for
    // a browser to present. Exposing this port beyond the workshop LAN would
    // need that decision revisited, not just a header added.
    if (state.token && url.pathname.startsWith('/v1/')) {
      if (!isAuthorized(request, state.token)) throw unauthorized();
    }

    const matched = matchRoute(request.method, url.pathname);
    if (!matched) {
      // An unmatched GET may still be a page or an asset of the UI — but never
      // under an API prefix. Letting `/v1/typo` fall through to the app shell
      // would answer a broken API call with HTML and a 200, which is far
      // harder to diagnose than the 404 it should be, and would quietly break
      // the documented `/v1` contract.
      const asset =
        request.method === 'GET' && !isApiPath(url.pathname)
          ? await serveStatic(state.services.webRoot, url.pathname)
          : undefined;
      if (asset) return asset;
      throw notFound();
    }

    return await invoke(matched.route, matched.params, request, url, state);
  } catch (error) {
    return errorResponse(error);
  }
}

interface MatchedRoute {
  route: Route;
  params: Record<string, string>;
}

/**
 * Matches a path against the table, capturing `:name` segments.
 *
 * Static segments win over parameters at the same position, so a future
 * literal route can be added beside a parameterised one without ordering
 * becoming load-bearing.
 */
function matchRoute(
  method: string,
  pathname: string,
): MatchedRoute | undefined {
  const requested = normalizePath(pathname).split('/');
  const candidates: MatchedRoute[] = [];
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
    // Prefer the pattern with the fewest captures — the most specific match.
    candidates.sort(
      (a, b) => Object.keys(a.params).length - Object.keys(b.params).length,
    );
    return candidates[0];
  }
  if (pathExists) {
    throw methodNotAllowed(allowedMethodsFor(requested));
  }
  return undefined;
}

function allowedMethodsFor(requested: string[]): string[] {
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

/** Prefixes reserved for JSON APIs, which never serve the UI. */
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

const MULTIPART = 'multipart/form-data';

/**
 * Methods whose request body the router decodes.
 *
 * `PATCH` belongs here as much as `POST` does: leaving it out does not fail,
 * it silently hands the handler an empty body, so an edit appears to succeed
 * while changing nothing.
 */
const CARRIES_A_BODY = new Set(['POST', 'PATCH', 'PUT']);

function isMultipart(request: Request): boolean {
  return (request.headers.get('content-type') ?? '')
    .toLowerCase()
    .includes(MULTIPART);
}

async function invoke(
  matched: Route,
  params: Record<string, string>,
  request: Request,
  url: URL,
  state: ServerState,
): Promise<RouteResponse> {
  const { services } = state;
  let body: RequestBody;
  let trace: SpooledTrace | undefined;

  if (matched.streaming || !CARRIES_A_BODY.has(matched.method)) {
    // The handler reads the request itself, or there is nothing to read.
    body = emptyBody(url);
  } else if (matched.gated && !isMultipart(request)) {
    // The documented fast path, and the one Oracle uses: the whole body is
    // the trace. It goes to disk as it arrives and never becomes a string in
    // this process, so a 311 MB upload costs the volume rather than the heap.
    // Options come from the query string, which is what that shape specifies.
    body = emptyBody(url);
    trace = await spoolStream(request, services);
  } else {
    body = await readRequestBody(request, url, services.maxBodyBytes);
    if (matched.gated) trace = await spoolBuffered(body, services);
  }

  try {
    return await matched.handle({
      request,
      url,
      params,
      body,
      trace,
      services,
      version: packageJson.version,
      uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
    } satisfies RouteContext);
  } finally {
    if (trace?.ephemeral) {
      await Bun.file(trace.path)
        .delete()
        .catch(() => {
          // Best effort: the retention sweep does not look at scratch files,
          // but a failure here is not worth failing an answered request over.
        });
    }
  }
}

/** A scratch path on the volume for one request's trace. */
function spoolPath(services: AppServices): string {
  return path.join(services.paths.spool, `${Bun.randomUUIDv7()}.MPF`);
}

/** Streams a raw-body trace to the volume without buffering it. */
async function spoolStream(
  request: Request,
  services: AppServices,
): Promise<SpooledTrace> {
  const upload = await spoolToFile(
    request,
    spoolPath(services),
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
  services: AppServices,
): Promise<SpooledTrace> {
  const source = body.document('trace');
  const destination = spoolPath(services);
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

/**
 * Where the built UI lives when it was not passed explicitly.
 *
 * The build output sits beside this package so a container copy keeps them
 * together. A missing directory is not an error: the API is useful on its own
 * and the server should still start for a caller that only wants `/v1`.
 */
function resolveBundledWebRoot(): string | undefined {
  const configured = Bun.env.ACHAR_WEB_ROOT?.trim();
  if (configured) return configured;
  return path.resolve(
    path.dirname(Bun.fileURLToPath(import.meta.url)),
    '../../web/dist',
  );
}

function createStop(
  server: { stop: (closeActive?: boolean) => unknown },
  services: { runner: JobRunner; pool: WorkerPool; store: JobStore },
) {
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    services.runner.stopRetentionSweep();
    await server.stop(true);
    await services.pool.shutdown();
    services.store.close();
  };
}

if (import.meta.main) {
  const { port } = await startAcharServer();
  console.log(`[achar] listening on ${port}`);
}
