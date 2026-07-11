import {
  compareAgainstReference,
  generatePostFiles,
  summarizeCompareResults,
  writeGeneratedFiles,
} from '@achar/core';
import type { Command } from 'commander';
import {
  compareOptions,
  maybeWriteReport,
  resolveInput,
  vmidExitCode,
} from '../inputs';
import {
  type CliOptions,
  withCompareOptions,
  withGenerationOptions,
  withVmidOptions,
} from '../options';
import { runCommand } from '../runner';
import { printCompareResults, printData, printVmidValidation } from '../ui';
import { watchRun } from '../watch';

export function registerParityCommand(cli: Command): void {
  withVmidOptions(
    withCompareOptions(
      withGenerationOptions(
        cli
          .command('parity <trace-or-fixture>')
          .description(
            'Generate files and compare them against reference G-code.',
          )
          .option('--reference <directory>', 'Reference G-code directory.'),
      ),
    ),
  )
    .option('--watch', 'Watch inputs and rerun parity on changes.')
    .action(
      runCommand(async (target: string, options: CliOptions) => {
        const runOnce = async (): Promise<number> => {
          const input = await resolveInput(target, options, {
            requireOut: true,
            requireReference: true,
          });
          printVmidValidation(input.vmidIssues, Boolean(input.vmid));
          const vmidCode = vmidExitCode(input.vmidIssues, options);
          if (vmidCode !== 0) return vmidCode;

          const files = generatePostFiles(
            input.events,
            input.programName,
            input.registerPost,
          );
          await writeGeneratedFiles(files, input.outputDir ?? '');
          const results = await compareAgainstReference(
            files,
            input.referenceDir ?? '',
            compareOptions(options),
          );
          await maybeWriteReport(options, results);

          if (options.json) {
            printData(
              JSON.stringify(
                {
                  summary: summarizeCompareResults(results),
                  vmidIssues: input.vmidIssues,
                  results,
                },
                null,
                2,
              ),
            );
          } else {
            printCompareResults(results);
          }

          const hasDifferences = results.some(
            (result) => result.status !== 'match',
          );
          return options.strict && hasDifferences ? 1 : 0;
        };

        return options.watch ? watchRun(target, options, runOnce) : runOnce();
      }),
    );
}
