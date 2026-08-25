import { tmpdir } from 'node:os';
import path from 'node:path';
import { Logger } from '@achar/core';
import packageJson from '../package.json' with { type: 'json' };
import type { ServerServices } from './context';
import type { RunningServer } from './kernel';
import { startKernel } from './kernel';
import { WorkerPool } from './parse/pool';
import { v1Routes } from './routes';

export type { RouteContext, ServerServices, SpooledTrace } from './context';
export * from './errors';
export type { RouteResponse } from './http';
export {
  attachment,
  byteLength,
  bytes,
  json,
  plainText,
  toResponse,
} from './http';
export type { KernelOptions, Route, RunningServer } from './kernel';
export { startKernel } from './kernel';
export { WorkerPool } from './parse/pool';
export type {
  AnalyzeOutcome,
  BundledFile,
  BundleOutcome,
  WorkerTask,
} from './parse/protocol';
export { spoolToFile } from './parse/spool';
export type { RequestBody } from './request';
export { v1Routes } from './routes';

/**
 * Stateless HTTP front end for `@achar/core`.
 *
 * Every request carries its own inputs and gets its results back in the
 * response: no workspace root, no database, no volume, and nothing retained
 * between requests. That is the difference from the MCP server, which runs
 * locally over stdio and can afford to be path-based — and from
 * `@achar/workshop`, which builds a multi-user service on this kernel and is
 * stateful by necessity.
 *
 * Traces are spooled to a scratch directory so a worker can read them by path
 * rather than receive a several-hundred-megabyte string across a thread
 * boundary. Those files are deleted as each request finishes; the promise is
 * that nothing survives a request, not that nothing is ever written.
 *
 * No trace is parsed on the HTTP thread. `Parser.parse()` is synchronous and
 * holds the loop for many seconds on a large file, so all of it happens on
 * worker threads; see {@link WorkerPool}.
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
  /** Scratch space for request bodies. Defaults to the system temp dir. */
  scratchDir?: string;
  /** Allow the parser's own logging. Off by default; it is very noisy. */
  logs?: boolean;
}

export type AcharServer = RunningServer;

export const DEFAULT_PORT = 7788;
export const DEFAULT_HOST = '127.0.0.1';

/**
 * Default upload ceiling.
 *
 * Sized from what actually parses, not from what a socket can carry. A 311 MB
 * trace peaks around 2 GB of worker memory; 384 MB leaves a little room above
 * the largest real trace seen while keeping the peak inside a 4 GB container.
 * Raising this is a statement about the host's RAM, not about the network.
 */
export const DEFAULT_MAX_BODY_BYTES = 384 * 1024 * 1024;
export const DEFAULT_MAX_CONCURRENT_PARSES = 1;

/**
 * Silences the parser's logging unless it was asked for.
 *
 * It emits hundreds of "Unknown event type for validation" warnings per trace,
 * which on a server is noise that would drown the access log. Exported because
 * anything embedding this kernel wants the same default.
 */
export function configureLogging(logs: boolean | undefined): void {
  if (logs !== true) Logger.setGlobalOptions({ enabled: false });
}

/** Builds the services `/v1` needs, and nothing more. */
export function createServerServices(
  options: AcharServerOptions,
): ServerServices {
  return {
    pool: new WorkerPool({
      size: options.maxConcurrentParses ?? DEFAULT_MAX_CONCURRENT_PARSES,
    }),
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    scratchDir: options.scratchDir ?? path.join(tmpdir(), 'achar-spool'),
  };
}

export async function startAcharServer(
  options: AcharServerOptions = {},
): Promise<AcharServer> {
  configureLogging(options.logs);
  const services = createServerServices(options);

  const server = startKernel({
    routes: v1Routes,
    services,
    version: packageJson.version,
    host: options.host ?? DEFAULT_HOST,
    port: options.port ?? DEFAULT_PORT,
    token: options.token?.trim() || undefined,
  });

  const stop = createStop(async () => {
    await server.stop();
    await services.pool.shutdown();
  });
  const onSignal = () => void stop();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return {
    port: server.port,
    stop: async () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      await stop();
    },
  };
}

/** Wraps a teardown so a second call — signal plus explicit — is harmless. */
export function createStop(teardown: () => Promise<void>): () => Promise<void> {
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    await teardown();
  };
}

if (import.meta.main) {
  const { port } = await startAcharServer();
  console.log(`[achar] listening on ${port}`);
}
