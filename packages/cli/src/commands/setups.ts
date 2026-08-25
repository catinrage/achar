import type { SetupOverview } from '@achar/core';
import {
  createProductProfileConsumer,
  createSetupPartitionConsumer,
  describeSetups,
  runConsumers,
  streamTraceFile,
} from '@achar/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import { resolveTraceTarget } from '../inputs';
import type { CliOptions } from '../options';
import { runCommand } from '../runner';
import { printData, printInfo } from '../ui';

export function registerSetupsCommand(cli: Command): void {
  cli
    .command('setups <trace-or-fixture>')
    .description(
      'List the setups in a trace, with the index `generate --setups` expects.',
    )
    .option('--json', 'Print the list as JSON on stdout.')
    .action(
      runCommand(async (target: string, options: CliOptions) => {
        const { tracePath } = await resolveTraceTarget(target, options);
        // Both folds run over one pass: the stream is single-use, and walking
        // it twice would silently produce an empty second answer.
        const partitionConsumer = createSetupPartitionConsumer();
        const profileConsumer = createProductProfileConsumer();
        runConsumers(await streamTraceFile(tracePath), [
          partitionConsumer,
          profileConsumer,
        ]);
        const partition = partitionConsumer.finish();

        if (partition.spans.length === 0) {
          printInfo(
            chalk.yellow(
              'This trace contains no @setup events; it posts as a single program.',
            ),
          );
          return 0;
        }

        const rows = describeSetups(profileConsumer.finish(), partition.spans);

        if (options.json) {
          printData(`${JSON.stringify(rows, null, 2)}\n`.trimEnd());
          return 0;
        }

        if (partition.hasImplicitSetup) {
          printInfo(
            chalk.yellow(
              '! This trace runs jobs before its first @setup. They belong to ' +
                'the shared prologue and are posted with every selection.',
            ),
          );
        }
        printData(renderTable(rows));
        printInfo(
          chalk.dim(
            `Post a subset with: achar generate ${target} --setups ${rows[0].index},${rows[rows.length - 1].index}`,
          ),
        );
        return 0;
      }),
    );
}

function renderTable(rows: SetupOverview[]): string {
  const header = ['#', 'Setup', 'Fixture', 'Home', 'Jobs', 'Duration'];
  const body = rows.map((row) => [
    String(row.index),
    row.name,
    row.fixtureName ?? '-',
    row.partHomeNumber === undefined ? '-' : String(row.partHomeNumber),
    String(row.jobCount),
    row.duration,
  ]);
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...body.map((line) => line[column].length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd();

  return [
    chalk.bold(line(header)),
    chalk.dim(widths.map((width) => '-'.repeat(width)).join('  ')),
    ...body.map(line),
  ].join('\n');
}
