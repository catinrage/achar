import type { ServerServices } from '@achar/server';
import type { DataPaths } from './data/paths';
import type { JobStore } from './data/store';
import type { JobRunner } from './jobs/runner';

/**
 * What the workshop's routes need on top of the stateless kernel.
 *
 * This is the whole of the difference between the two packages. `/v1` runs on
 * {@link ServerServices} alone — a worker pool and a size limit — while every
 * field added here is state that outlives a request.
 */
export interface WorkshopServices extends ServerServices {
  store: JobStore;
  paths: DataPaths;
  runner: JobRunner;
  /** Directory holding the built web UI, when one is present. */
  webRoot: string | undefined;
}
