import path from 'node:path';
import packageJson from '../../package.json' with { type: 'json' };
import type { RunningServer } from '../kernel/kernel';
import { startKernel } from '../kernel/kernel';
import type { AcharServerOptions } from '../kernel/services';
import {
  configureLogging,
  createServerServices,
  createStop,
  DEFAULT_HOST,
  DEFAULT_PORT,
} from '../kernel/services';
import { v1Routes } from '../v1/routes';
import type { WorkshopServices } from './context';
import { prepareDataPaths } from './data/paths';
import { JobStore } from './data/store';
import { JobRunner } from './jobs/runner';
import { migrateWorkshopData } from './migrate';
import { workshopRoutes } from './routes';
import { serveStatic } from './static';

/**
 * The workshop service: a browser UI and a shared job queue, built on the
 * stateless kernel in `@achar/server`.
 *
 * Everything stateful lives on this side of the line — the SQLite database,
 * the queue, machine presets, generated output, retention. `@achar/server`
 * stays a package with no volume and no database, so `/v1` remains as simple
 * to reason about as its contract claims.
 *
 * Both route tables are served from one process because they share the
 * expensive part: a worker pool that keeps trace parsing off the HTTP thread.
 * Running them separately would mean two pools, and memory — not CPU — is what
 * bounds parsing.
 */

export interface WorkshopServerOptions extends AcharServerOptions {
  /** Volume root for the job queue. Defaults to `ACHAR_DATA_DIR`. */
  dataDir?: string;
  /** Directory holding the built web UI. */
  webRoot?: string;
  /** Days an uploaded trace is kept before the retention sweep removes it. */
  retentionDays?: number;
}

export type WorkshopServer = RunningServer;

export async function startWorkshopServer(
  options: WorkshopServerOptions = {},
): Promise<WorkshopServer> {
  configureLogging(options.logs);

  const paths = prepareDataPaths(options.dataDir);
  const store = new JobStore(paths);
  const base = createServerServices({
    ...options,
    // Scratch goes on the volume rather than the system temp dir: a container
    // with a read-only root and a small tmpfs cannot hold a 300 MB body, and
    // the volume is already sized for exactly that.
    scratchDir: options.scratchDir ?? paths.spool,
  });
  const runner = new JobRunner(store, paths, base.pool, {
    retentionDays: options.retentionDays,
  });

  const services: WorkshopServices = {
    ...base,
    store,
    paths,
    runner,
    webRoot: options.webRoot ?? resolveBundledWebRoot(),
  };

  // Before anything can read either: the column is the only place this package
  // looks for a profile, and the trace store the only place it looks for an
  // upload, so a machine or a job left in the old layout would otherwise look
  // like one that never had them.
  await migrateWorkshopData(store, paths);

  runner.recover();
  runner.startRetentionSweep();

  const server = startKernel<WorkshopServices>({
    routes: [...v1Routes, ...workshopRoutes],
    services,
    version: packageJson.version,
    host: options.host ?? DEFAULT_HOST,
    port: options.port ?? DEFAULT_PORT,
    token: options.token?.trim() || undefined,
    onUnmatched: (url) => serveStatic(services.webRoot, url.pathname),
  });

  const stop = createStop(async () => {
    runner.stopRetentionSweep();
    await server.stop();
    await services.pool.shutdown();
    store.close();
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
  // From `packages/server/src/workshop/` up to `packages/`, then into the web
  // package's build output. `@achar/web` is deliberately still its own
  // package — it is a browser build with its own toolchain, and keeping it out
  // of this one is what keeps the Svelte compiler out of the runtime image.
  return path.resolve(
    path.dirname(Bun.fileURLToPath(import.meta.url)),
    '../../../web/dist',
  );
}

if (import.meta.main) {
  const { port } = await startWorkshopServer();
  console.log(`[achar] listening on ${port}`);
}
