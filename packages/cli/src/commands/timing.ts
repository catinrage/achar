import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractTimingReport, streamTraceFile } from '@achar/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import { resolveTraceTarget } from '../inputs';
import type { CliOptions } from '../options';
import { runCommand } from '../runner';
import { printData, printInfo } from '../ui';

export function registerTimingCommand(cli: Command): void {
  cli
    .command('timing <trace-or-fixture>')
    .description(
      'Extract per-setup and per-tool machining durations from a trace.',
    )
    .option(
      '--out <file-or-directory>',
      'JSON destination. Defaults to <fixture out>/timing.json.',
    )
    .option('--json', 'Print the report to stdout instead of writing a file.')
    .action(
      runCommand(async (target: string, options: CliOptions) => {
        const { tracePath, outputDir } = await resolveTraceTarget(
          target,
          options,
        );
        const report = extractTimingReport(await streamTraceFile(tracePath));
        const json = `${JSON.stringify(report, null, 2)}\n`;

        if (options.json) {
          printData(json.trimEnd());
          return 0;
        }

        const outPath = resolveTimingOutPath(options.out, outputDir);
        if (!outPath) {
          printData(json.trimEnd());
          return 0;
        }

        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, json);
        printInfo(
          chalk.green(
            `Timing report (${report.setups.length} setup(s), ${report.tools.length} tool(s), total ${report.duration}) -> ${outPath}`,
          ),
        );
        return 0;
      }),
    );
}

function resolveTimingOutPath(
  out: string | undefined,
  fixtureOut: string | undefined,
): string | undefined {
  if (typeof out === 'string') {
    return out.toLowerCase().endsWith('.json')
      ? path.resolve(out)
      : path.resolve(out, 'timing.json');
  }
  return fixtureOut ? path.join(fixtureOut, 'timing.json') : undefined;
}
