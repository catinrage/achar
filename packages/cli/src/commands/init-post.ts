import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { CliOptions } from '../options';
import { runCommand } from '../runner';
import { initPost } from '../scaffold';
import { printInfo } from '../ui';

export function registerInitPostCommand(cli: Command): void {
  cli
    .command('init-post <directory>')
    .description('Create a new Achar post module skeleton.')
    .option('--name <name>', 'Human-readable post name.')
    .option('--force', 'Overwrite scaffold files if they already exist.')
    .option('--fixture', 'Create achar.fixture.json with supplied paths.')
    .option('--trace <file>', 'Fixture trace path.')
    .option('--reference <directory>', 'Fixture reference G-code directory.')
    .option('--program-name <name>', 'Fixture program name.')
    .option('--vmid <file>', 'Fixture VMID path.')
    .option('--machine-profile <file>', 'Fixture machine profile path.')
    .action(
      runCommand(async (directory: string, options: CliOptions) => {
        await initPost(directory, options);
        printInfo(
          chalk.green(`Created post scaffold -> ${path.resolve(directory)}`),
        );
        return 0;
      }),
    );
}
