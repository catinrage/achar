#!/usr/bin/env bun

import { Logger } from '@achar/core';
import chalk from 'chalk';
import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import { registerExplainCommand } from './commands/explain';
import { registerGenerateCommand } from './commands/generate';
import { registerInitPostCommand } from './commands/init-post';
import { registerLintPostCommand } from './commands/lint-post';
import { registerMcpCommand } from './commands/mcp';
import { registerParityCommand } from './commands/parity';
import { registerParseCommand } from './commands/parse';
import { registerPostsCommand } from './commands/posts';
import { registerTestCommand } from './commands/test';
import { registerTimingCommand } from './commands/timing';
import { registerValidateCommand } from './commands/validate';
import { registerVmidCommands } from './commands/vmid';

Logger.setGlobalOptions({ enabled: false });

const cli = new Command();

cli
  .name('achar')
  .usage('<command> [options]')
  .description('SolidCAM trace post-processing tools.')
  .version(packageJson.version)
  .showHelpAfterError();

registerParseCommand(cli);
registerVmidCommands(cli);
registerLintPostCommand(cli);
registerExplainCommand(cli);
registerPostsCommand(cli);
registerMcpCommand(cli);
registerInitPostCommand(cli);
registerValidateCommand(cli);
registerGenerateCommand(cli);
registerParityCommand(cli);
registerTestCommand(cli);
registerTimingCommand(cli);

cli.helpCommand(true);

try {
  if (process.argv.length <= 2) {
    cli.outputHelp();
    process.exitCode = 0;
  } else {
    await cli.parseAsync(process.argv);
  }
} catch (error) {
  console.error(
    chalk.red(error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
}
