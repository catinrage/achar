import { Logger } from '@achar/core';
import packageJson from '../package.json' with { type: 'json' };
import { isAuthorized } from './auth';
import {
  busy,
  HttpError,
  internalError,
  messageOf,
  methodNotAllowed,
  notFound,
  unauthorized,
} from './errors';
import type { RouteResponse } from './http';
import { byteLength, json, toResponse } from './http';
import { RequestBody, readRequestBody } from './request';
import type { Route } from './routes';
import { routes } from './routes';
import { Semaphore } from './semaphore';

/**
 * Stateless HTTP front end for `@achar/core`.
 *
 * Every request carries its own inputs and gets its results back in the
 * response: no workspace root, no server-side paths, no writes to disk, and
 * nothing retained between requests. That is the difference from the MCP
 * server, which runs locally over stdio and can afford to be path-based.
 *
 * This layer only routes, decodes, limits, authenticates, and maps errors.
 * All machining logic lives in core.
 */

export interface AcharServerOptions {
  /** Defaults to 7788. Pass 0 to let the OS choose a free port. */
  port?: number;
  /** Defaults to loopback. Binding publicly must be a deliberate choice. */
  host?: string;
  /** When set, every `/v1/*` route requires `Authorization: Bearer <token>`. */
  token?: string;
  /** Defaults to 128 MB — the largest trace here is 67 MB. */
  maxBodyBytes?: number;
  /** Concurrent trace parses. Defaults to 1; see {@link Semaphore}. */
  maxConcurrentParses?: number;
  /** Allow the parser's own logging. Off by default; it is very noisy. */
  logs?: boolean;
}

export interface AcharServer {
  port: number;
  stop: () => Promise<void>;
}

const DEFAULT_PORT = 7788;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_MAX_BODY_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_PARSES = 1;
const RETRY_AFTER_SECONDS = 5;
/**
 * How much larger the runtime's body cap is than ours.
 *
 * Bun enforces `maxRequestBodySize` itself and answers an over-limit request
 * with a bodyless 413, before any route of ours runs. Giving it headroom means
 * a body that merely overshoots the configured limit reaches our own
 * `Content-Length` check and gets the documented `{ error }` JSON instead.
 * Past this multiple the runtime wins and the 413 has no body — the trade is
 * deliberate, since the alternative is letting an arbitrarily large upload
 * buffer just to phrase its rejection nicely.
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
  const parseSlots = new Semaphore(
    options.maxConcurrentParses ?? DEFAULT_MAX_CONCURRENT_PARSES,
  );
  const startedAt = Date.now();

  const server = Bun.serve({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.host ?? DEFAULT_HOST,
    // See BODY_LIMIT_HEADROOM. This also stays the only bound available for
    // chunked bodies, which declare no length and so cannot be checked up
    // front.
    maxRequestBodySize: maxBodyBytes * BODY_LIMIT_HEADROOM,
    fetch: (request) =>
      handleRequest(request, {
        maxBodyBytes,
        token,
        parseSlots,
        startedAt,
      }),
  });

  const stop = createStop(server);
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
  maxBodyBytes: number;
  token: string | undefined;
  parseSlots: Semaphore;
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
    if (state.token && url.pathname.startsWith('/v1/')) {
      if (!isAuthorized(request, state.token)) throw unauthorized();
    }

    return await invoke(
      matchRoute(request.method, url.pathname),
      request,
      url,
      state,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function matchRoute(method: string, pathname: string): Route {
  const path = normalizePath(pathname);
  const candidates = routes.filter((candidate) => candidate.path === path);
  if (candidates.length === 0) throw notFound();

  const matched = candidates.find((candidate) => candidate.method === method);
  if (!matched) {
    throw methodNotAllowed(candidates.map((candidate) => candidate.method));
  }
  return matched;
}

/** Tolerates a trailing slash so `/v1/posts/` is not a 404. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
}

async function invoke(
  matched: Route,
  request: Request,
  url: URL,
  state: ServerState,
): Promise<RouteResponse> {
  // Claimed before the body is read: buffering several 67 MB uploads is
  // itself enough to exhaust the host, parse or no parse.
  const release = matched.gated ? state.parseSlots.tryAcquire() : () => {};
  if (!release) throw busy(RETRY_AFTER_SECONDS);

  try {
    const body =
      matched.method === 'POST'
        ? await readRequestBody(request, url, state.maxBodyBytes)
        : emptyBody(url);

    return matched.handle({
      body,
      version: packageJson.version,
      uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
    });
  } finally {
    release();
  }
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
 * answers before consuming the body, by design: refusing a 67 MB upload
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

function createStop(server: { stop: (closeActive?: boolean) => unknown }) {
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    await server.stop(true);
  };
}

if (import.meta.main) {
  const { port } = await startAcharServer();
  console.log(`[achar] listening on ${port}`);
}
