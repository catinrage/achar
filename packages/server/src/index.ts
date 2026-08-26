/**
 * HTTP front ends for `@achar/core`.
 *
 * One package, three layers, and the order between them is the whole point:
 *
 * - `kernel/` is transport and execution — routing, request bodies, errors,
 *   auth, the worker pool, and the stateless document loading every operation
 *   shares. It knows nothing about who is calling.
 * - `v1/` is the stateless API. Every request carries its own inputs and gets
 *   its results back in the response: no workspace root, no database, no
 *   volume, and nothing retained between requests. Traces are spooled so a
 *   worker can read them by path rather than take a several-hundred-megabyte
 *   string across a thread boundary, and those files are deleted as each
 *   request finishes; the promise is that nothing survives a request, not that
 *   nothing is ever written.
 * - `workshop/` is the stateful service: a job queue, machine records and the
 *   browser API, built on the same kernel.
 *
 * `v1/` must never import `workshop/`. That used to be enforced by npm — the
 * two were separate packages pointing one way — and is now a fallow boundary
 * rule, because the dependency edge was the only thing the split was still
 * buying and it cost a package to keep. The rule is not decoration: the
 * statelessness of `/v1` is a promise made to callers in
 * `docs/http-server.md`, and it holds only while no handler there can reach a
 * store.
 *
 * No trace is parsed on the HTTP thread. `Parser.parse()` is synchronous and
 * holds the loop for many seconds on a large file, so all of it happens on
 * worker threads; see {@link WorkerPool}.
 */

export type {
  RouteContext,
  ServerServices,
  SpooledTrace,
} from './kernel/context';
export * from './kernel/errors';
export type { RouteResponse } from './kernel/http';
export {
  attachment,
  byteLength,
  bytes,
  json,
  plainText,
  toResponse,
} from './kernel/http';
export type { KernelOptions, Route, RunningServer } from './kernel/kernel';
export { startKernel } from './kernel/kernel';
export { WorkerPool } from './kernel/parse/pool';
export type {
  AnalyzeOutcome,
  BundledFile,
  BundleOutcome,
  WorkerTask,
} from './kernel/parse/protocol';
export { spoolToFile } from './kernel/parse/spool';
export type { RequestBody } from './kernel/request';
export type {
  AcharServer,
  AcharServerOptions,
} from './kernel/services';
export {
  configureLogging,
  createServerServices,
  createStop,
  DEFAULT_HOST,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_CONCURRENT_PARSES,
  DEFAULT_PORT,
} from './kernel/services';
export { v1Routes } from './v1/routes';
export { startAcharServer } from './v1/server';

// The stateful front end. Exported from the same package as `v1Routes`, which
// is exactly why `v1/` may not import `workshop/`: see the fallow boundary
// rule and the note above.
export type {
  WorkshopServer,
  WorkshopServerOptions,
} from './workshop/workshop';
export { startWorkshopServer } from './workshop/workshop';
