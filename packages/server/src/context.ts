import type { WorkerPool } from './parse/pool';
import type { RequestBody } from './request';

/**
 * What a route handler is given.
 *
 * Handlers stay thin: decode, call a service, shape the response. Anything
 * that looks like machining logic belongs in `@achar/core`, and anything that
 * reads a trace belongs on a worker — see {@link ServerServices.pool}.
 *
 * `Services` is a type parameter so a package built on this kernel can add its
 * own dependencies without this one having to know about them. `@achar/server`
 * itself needs only {@link ServerServices}; `@achar/workshop` widens it.
 */

export interface ServerServices {
  /** Every trace parse goes through here, never on the HTTP thread. */
  pool: WorkerPool;
  maxBodyBytes: number;
  /**
   * Where a request body is spooled so a worker can read it by path.
   *
   * Scratch only. Files here are written for the life of one request and
   * deleted in a `finally`, which is what keeps this package's promise that
   * nothing is retained between requests.
   */
  scratchDir: string;
}

/** A trace already written to disk, ready to hand to a worker. */
export interface SpooledTrace {
  path: string;
  bytes: number;
  sha256: string;
  /** Original upload filename, when the client supplied one. */
  name: string;
  /** True when the file is scratch and should be deleted after the request. */
  ephemeral: boolean;
}

export interface RouteContext<
  Services extends ServerServices = ServerServices,
> {
  request: Request;
  url: URL;
  /** Values captured from `:name` segments in the route path. */
  params: Record<string, string>;
  body: RequestBody;
  /** Present on gated routes, which spool their trace before dispatching. */
  trace?: SpooledTrace;
  services: Services;
  version: string;
  uptimeSeconds: number;
}
