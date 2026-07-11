import path from 'node:path';
import { startAcharMcpServer } from '@achar/mcp';
import type { Command } from 'commander';
import type { CliOptions } from '../options';
import { runCommand } from '../runner';

export function registerMcpCommand(cli: Command): void {
  cli
    .command('mcp')
    .description('Run the Achar MCP stdio server for LLM clients.')
    .option(
      '--workspace <directory>',
      'Workspace root. Defaults to ACHAR_WORKSPACE or the current project.',
    )
    .option('--logs', 'Allow parser/backend logs on stderr.')
    .action(
      runCommand(async (options: CliOptions) => {
        await startAcharMcpServer({
          workspaceRoot: options.workspace
            ? path.resolve(options.workspace)
            : undefined,
          logs: options.logs,
        });
        return 0;
      }),
    );
}
