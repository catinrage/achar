import { readFile } from 'node:fs/promises';
import {
  formatPostLintIssues,
  lintPostSource,
  lintUnhandledEvents,
  loadPost,
  Program,
  parseTraceFile,
} from '@achar/core';
import type { Command } from 'commander';
import type { CliOptions } from '../options';
import { runCommand } from '../runner';
import { printData } from '../ui';

export function registerLintPostCommand(cli: Command): void {
  cli
    .command('lint-post <file>')
    .description('Check an Achar post for maintainability issues.')
    .option('--driver', 'Treat the source as a controller driver.')
    .option('--trace <file>', 'Also report trace events without handlers.')
    .action(
      runCommand(async (file: string, options: CliOptions) => {
        const issues = lintPostSource(await readFile(file, 'utf-8'), {
          driverFile: options.driver,
        });
        if (options.trace) {
          const program = new Program();
          (await loadPost(file))(program);
          issues.push(
            ...lintUnhandledEvents(
              await parseTraceFile(options.trace),
              program.registeredEvents(),
            ),
          );
        }
        printData(formatPostLintIssues(issues));
        return issues.length === 0 ? 0 : 1;
      }),
    );
}
