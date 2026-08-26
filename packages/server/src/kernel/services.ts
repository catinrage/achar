import { tmpdir } from 'node:os';
import path from 'node:path';
import { Logger } from '@achar/core';
import type { ServerServices } from './context';
import type { RunningServer } from './kernel';
import { WorkerPool } from './parse/pool';

/**
 * Assembly shared by everything built on this kernel.
 *
 * Both front ends in this package start the same way — silence the parser,
 * build a worker pool and a scratch directory, wrap teardown — and neither
 * owns those decisions. They live here so `/v1` and the workshop cannot drift
 * on the size of an upload or the number of concurrent parses.
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

/** Wraps a teardown so a second call — signal plus explicit — is harmless. */
export function createStop(teardown: () => Promise<void>): () => Promise<void> {
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    await teardown();
  };
}
