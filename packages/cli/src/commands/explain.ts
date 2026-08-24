import { generatePostProgram } from '@achar/core';
import type { Command } from 'commander';
import { resolveInput } from '../inputs';
import { type CliOptions, withSetupSelectionOptions } from '../options';
import { runCommand } from '../runner';
import { printData } from '../ui';

export function registerExplainCommand(cli: Command): void {
  withSetupSelectionOptions(
    cli
      .command('explain <trace-or-fixture>')
      .description('Explain which event emitted each command.'),
  )
    .option('--post <name-or-file>', 'Post module.')
    .option('--machine-profile <file>', 'Machine profile JSON file.')
    .option('--program-name <name>', 'Program name.')
    .option('--file <name>', 'Filter by generated MPF/SPF file.')
    .option('--event <name>', 'Filter by trace event name.')
    .action(
      runCommand(async (target: string, options: CliOptions) => {
        const input = await resolveInput(target, options);
        const program = generatePostProgram(
          input.events,
          input.programName,
          input.registerPost,
        );
        printData(
          program.explain({ file: options.file, event: options.event }),
        );
        return 0;
      }),
    );
}
