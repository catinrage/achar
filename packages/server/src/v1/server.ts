import packageJson from '../../package.json' with { type: 'json' };
import { startKernel } from '../kernel/kernel';
import {
  type AcharServer,
  type AcharServerOptions,
  configureLogging,
  createServerServices,
  createStop,
  DEFAULT_HOST,
  DEFAULT_PORT,
} from '../kernel/services';
import { v1Routes } from './routes';

/**
 * The stateless front end on its own.
 *
 * Serves `/v1` and nothing else: no volume, no database, no static assets.
 * `startWorkshopServer` mounts these same routes alongside a stateful queue
 * when a deployment wants both from one port; this entry point is for one
 * that does not.
 */
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

if (import.meta.main) {
  const { port } = await startAcharServer();
  console.log(`[achar] listening on ${port}`);
}
