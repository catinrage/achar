import { startWorkshopServer } from '@achar/workshop';
import type { Command } from 'commander';
import type { CliOptions } from '../options';
import { parsePositiveInteger } from '../options';
import { runCommand } from '../runner';

const DEFAULT_PORT = 7788;
const DEFAULT_HOST = '127.0.0.1';
const BYTES_PER_MB = 1024 * 1024;
/** Mirrors the server's own defaults, for help text only. */
const DEFAULT_MAX_BODY_MB = 384;
const DEFAULT_RETENTION_DAYS = 14;

export function registerServeCommand(cli: Command): void {
  cli
    .command('serve')
    .description(
      'Run the Achar server: the workshop web UI plus the /v1 HTTP API.',
    )
    .option(
      '--port <number>',
      `Port to listen on. Defaults to ACHAR_SERVER_PORT or ${DEFAULT_PORT}.`,
      parsePositiveInteger,
    )
    .option(
      '--host <host>',
      `Interface to bind. Defaults to ACHAR_SERVER_HOST or ${DEFAULT_HOST}.`,
    )
    .option(
      '--token <token>',
      'Require this bearer token on /v1 routes. Defaults to ACHAR_SERVER_TOKEN.',
    )
    .option(
      '--max-body <mb>',
      `Maximum trace upload size in megabytes. Defaults to ${DEFAULT_MAX_BODY_MB}, which is sized from what a worker can actually parse rather than from what the network can carry.`,
      parsePositiveInteger,
    )
    .option(
      '--max-parses <n>',
      'Concurrent trace parses. Bounded by memory, not CPU: one 311MB trace peaks around 2GB.',
      parsePositiveInteger,
    )
    .option(
      '--data-dir <path>',
      'Volume for the job queue, uploads and generated output. Defaults to ACHAR_DATA_DIR.',
    )
    .option(
      '--web-root <path>',
      'Directory holding the built web UI. Defaults to ACHAR_WEB_ROOT, then the bundled build.',
    )
    .option(
      '--retention-days <n>',
      `Days an uploaded trace is kept before it is deleted. Generated output and job history are kept regardless. Defaults to ${DEFAULT_RETENTION_DAYS}.`,
      parsePositiveInteger,
    )
    .option('--logs', 'Allow parser/backend logs.')
    .action(
      runCommand(async (options: CliOptions) => {
        const host = options.host ?? Bun.env.ACHAR_SERVER_HOST ?? DEFAULT_HOST;
        const server = await startWorkshopServer({
          port: options.port ?? envPort() ?? DEFAULT_PORT,
          host,
          token: options.token ?? Bun.env.ACHAR_SERVER_TOKEN,
          maxBodyBytes:
            options.maxBody === undefined
              ? undefined
              : options.maxBody * BYTES_PER_MB,
          maxConcurrentParses: options.maxParses,
          dataDir: options.dataDir ?? Bun.env.ACHAR_DATA_DIR,
          webRoot: options.webRoot ?? Bun.env.ACHAR_WEB_ROOT,
          retentionDays: options.retentionDays,
          logs: options.logs,
        });

        console.log(
          `Achar listening on http://${host}:${server.port}  (UI at /, API at /v1)`,
        );
        if (!options.token && !Bun.env.ACHAR_SERVER_TOKEN) {
          console.log(
            'No token configured: every /v1 route is open. Do not expose this port to untrusted networks.',
          );
        }

        // Resolving here would let the CLI runner set an exit code and tear
        // the process down; the server owns the process until a signal stops
        // it, so the command intentionally never returns.
        await new Promise<never>(() => {});
        return 0;
      }),
    );
}

function envPort(): number | undefined {
  const raw = Bun.env.ACHAR_SERVER_PORT?.trim();
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`ACHAR_SERVER_PORT must be a port number, got "${raw}".`);
  }
  return parsed;
}
