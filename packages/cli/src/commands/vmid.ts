import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatVmidSummary,
  generateVmidTraceTypes,
  parseVmidFile,
} from '@achar/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { CliOptions } from '../options';
import { runCommand } from '../runner';
import { printData, printInfo } from '../ui';

export function registerVmidCommands(cli: Command): void {
  cli
    .command('vmid <vmid>')
    .description('Inspect a SolidCAM VMID file.')
    .option('--json', 'Print parsed VMID data as JSON.')
    .action(
      runCommand(async (vmidPath: string, options: CliOptions) => {
        const vmid = await parseVmidFile(vmidPath);

        if (options.json) {
          printData(JSON.stringify(vmid, null, 2));
        } else {
          printData(chalk.green(formatVmidSummary(vmid)));
        }

        return 0;
      }),
    );

  cli
    .command('vmid-types <vmid>')
    .description('Generate TypeScript trace extensions from a VMID.')
    .option(
      '--out <file>',
      'Output TypeScript file; prints to stdout when omitted.',
    )
    .option('--interface-name <name>', 'Base interface name.')
    .action(
      runCommand(async (vmidPath: string, options: CliOptions) => {
        const source = generateVmidTraceTypes(await parseVmidFile(vmidPath), {
          interfaceName: options.interfaceName,
        });
        if (options.out) {
          await mkdir(path.dirname(options.out), { recursive: true });
          await writeFile(options.out, source);
          printInfo(chalk.green(`Generated VMID types -> ${options.out}`));
        } else {
          printData(source);
        }
        return 0;
      }),
    );
}
