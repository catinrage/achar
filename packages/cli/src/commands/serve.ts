import { startAcharServer } from '@achar/server';
import type { Command } from 'commander';
import type { CliOptions } from '../options';
import { parsePositiveInteger } from '../options';
import { runCommand } from '../runner';

const DEFAULT_PORT = 7788;
const DEFAULT_HOST = '127.0.0.1';
const BYTES_PER_MB = 1024 * 1024;

export function registerServeCommand(cli: Command): void {
  cli
    .command('serve')
    .description('Run the stateless Achar HTTP server.')
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
      'Maximum request body size in megabytes.',
      parsePositiveInteger,
    )
    .option(
      '--max-parses <n>',
      'Concurrent trace parses before returning 503.',
      parsePositiveInteger,
    )
    .option('--logs', 'Allow parser/backend logs.')
    .action(
      runCommand(async (options: CliOptions) => {
        const host = options.host ?? Bun.env.ACHAR_SERVER_HOST ?? DEFAULT_HOST;
        const server = await startAcharServer({
          port: options.port ?? envPort() ?? DEFAULT_PORT,
          host,
          token: options.token ?? Bun.env.ACHAR_SERVER_TOKEN,
          maxBodyBytes:
            options.maxBody === undefined
              ? undefined
              : options.maxBody * BYTES_PER_MB,
          maxConcurrentParses: options.maxParses,
          logs: options.logs,
        });

        console.log(
          `Achar HTTP server listening on http://${host}:${server.port}`,
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
