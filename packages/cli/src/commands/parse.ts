import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTraceFile } from '@achar/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import { requireString } from '../inputs';
import type { CliOptions } from '../options';
import { runCommand } from '../runner';
import { printInfo } from '../ui';

export function registerParseCommand(cli: Command): void {
  cli
    .command('parse <trace>')
    .description('Parse a SolidCAM trace into Achar IR JSON.')
    .option('--out <file>', 'Output JSON file.')
    .action(
      runCommand(async (trace: string, options: CliOptions) => {
        const outPath = requireString(options.out, 'out');
        const events = await parseTraceFile(trace);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, JSON.stringify(events, null, 2));
        printInfo(chalk.green(`Parsed ${events.length} events -> ${outPath}`));
        return 0;
      }),
    );
}
