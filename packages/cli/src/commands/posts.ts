import { listBuiltinPosts } from '@achar/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import { runCommand } from '../runner';
import { printData } from '../ui';

export function registerPostsCommand(cli: Command): void {
  cli
    .command('posts')
    .description('List built-in post modules.')
    .action(
      runCommand(() => {
        for (const post of listBuiltinPosts()) {
          const aliases =
            post.aliases.length > 0
              ? chalk.dim(` aliases: ${post.aliases.join(', ')}`)
              : '';
          const dialects = chalk.dim(` dialects: ${post.dialects.join(', ')}`);
          printData(
            `${chalk.green(post.id)}  ${post.name}${aliases}${dialects}`,
          );
        }

        return 0;
      }),
    );
}
