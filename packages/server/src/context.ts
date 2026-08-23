import type { GeneratedFile } from '@achar/core';
import type { DataPaths } from './data/paths';
import type { JobStore } from './data/store';
import type { WorkerPool } from './jobs/pool';
import type { JobRunner } from './jobs/runner';
import type { RequestBody } from './request';

/**
 * What a route handler is given.
 *
 * Handlers stay thin: decode, call a service, shape the response. Anything
 * that looks like machining logic belongs in `@achar/core`, and anything that
 * reads a trace belongs in a worker — see {@link AppServices.pool}.
 */

export interface AppServices {
  store: JobStore;
  paths: DataPaths;
  /** Every trace parse goes through here, never on the HTTP thread. */
  pool: WorkerPool;
  runner: JobRunner;
  maxBodyBytes: number;
  /** Directory holding the built web UI, when one is present. */
  webRoot: string | undefined;
}

/** A trace already written to the volume, ready to hand to a worker. */
export interface SpooledTrace {
  path: string;
  bytes: number;
  sha256: string;
  /** Original upload filename, when the client supplied one. */
  name: string;
  /** True when the file is scratch and should be deleted after the request. */
  ephemeral: boolean;
}

export interface RouteContext {
  request: Request;
  url: URL;
  /** Values captured from `:name` segments in the route path. */
  params: Record<string, string>;
  body: RequestBody;
  /** Present on gated routes, which spool their trace before dispatching. */
  trace?: SpooledTrace;
  services: AppServices;
  version: string;
  uptimeSeconds: number;
}

export interface RouteResponseInit {
  status: number;
  body: string;
  contentType: string;
  headers?: Record<string, string>;
}

/** Reference NC files uploaded for a parity comparison. */
export type ReferenceFiles = GeneratedFile[];
