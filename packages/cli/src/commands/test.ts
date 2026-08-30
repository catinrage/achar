import path from 'node:path';
import type { CompareResult, VmidValidationIssue } from '@achar/core';
import {
  discoverFixtures,
  summarizeCompareResults,
  testPost,
} from '@achar/core';
import chalk from 'chalk';
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
import {
  printCompareResults,
  printData,
  printFileLifecycleIssues,
  printInfo,
  printVmidValidation,
} from '../ui';
import { watchRun } from '../watch';

interface FixtureReport {
  name: string | null;
  summary: ReturnType<typeof summarizeCompareResults>;
  vmidIssues: VmidValidationIssue[];
  results: CompareResult[];
}

export function registerTestCommand(cli: Command): void {
  withVmidOptions(
    withCompareOptions(
      withGenerationOptions(
        cli
          .command('test <trace-fixture-or-root>')
          .description(
            'Run golden-output post regression tests. Fails on any mismatch.',
          )
          .option('--reference <directory>', 'Reference G-code directory.'),
      ),
    ),
  )
    .option(
      '--all',
      'Discover and run every fixture under the target directory.',
    )
    .option('--update', 'Update reference G-code with generated output.')
    .option('--watch', 'Watch inputs and rerun tests on changes.')
    .action(
      runCommand(async (target: string, options: CliOptions) => {
        const runOnce = async (): Promise<number> => {
          if (options.all) {
            return runAllFixtures(target, options);
          }

          const input = await resolveInput(target, options, {
            requireReference: true,
          });
          if (input.fixture?.ignored) {
            printInfo(
              chalk.yellow(
                `Note: fixture "${input.fixture.name}" is marked ignored; running because it was targeted directly.`,
              ),
            );
          }
          const result = await testPost({
            trace: input.tracePath,
            reference: input.referenceDir ?? '',
            out: input.outputDir,
            programName: input.programName,
            registerPost: input.registerPost,
            compare: compareOptions(options),
            update: options.update === true,
            vmid: input.vmid,
            machineProfile: input.machineProfile,
          });

          const failed =
            result.results.some(
              (compareResult) => compareResult.status !== 'match',
            ) ||
            result.fileLifecycleIssues.length > 0 ||
            vmidExitCode(result.vmidIssues, options) !== 0;

          await maybeWriteReport(options, result.results);

          if (options.json) {
            const report: FixtureReport = {
              name: input.fixture?.name ?? null,
              summary: summarizeCompareResults(result.results),
              vmidIssues: result.vmidIssues,
              results: result.results,
            };
            printData(JSON.stringify({ fixtures: [report], failed }, null, 2));
          } else {
            printVmidValidation(result.vmidIssues, Boolean(input.vmid));
            printFileLifecycleIssues(result.fileLifecycleIssues);
            printCompareResults(result.results);
          }

          return failed ? 1 : 0;
        };

        return options.watch ? watchRun(target, options, runOnce) : runOnce();
      }),
    );
}

async function runAllFixtures(
  target: string,
  options: CliOptions,
): Promise<number> {
  const allFixtures = await discoverFixtures(target, { includeIgnored: true });
  const fixtures = allFixtures.filter((fixture) => !fixture.ignored);
  const skipped = allFixtures.length - fixtures.length;
  if (skipped > 0) {
    printInfo(
      chalk.dim(
        `Skipped ${skipped} ignored fixture(s): ${allFixtures
          .filter((fixture) => fixture.ignored)
          .map((fixture) => fixture.name)
          .join(', ')}`,
      ),
    );
  }
  const allResults: CompareResult[] = [];
  const reports: FixtureReport[] = [];
  let hasFailure = false;

  for (const fixture of fixtures) {
    const input = await resolveInput(fixture.root, options, {
      fixture,
      requireReference: true,
    });
    const result = await testPost({
      trace: fixture.trace,
      reference: fixture.reference,
      out:
        typeof options.out === 'string'
          ? path.join(options.out, fixture.name)
          : fixture.out,
      programName: fixture.programName,
      registerPost: input.registerPost,
      compare: compareOptions(options),
      update: options.update === true,
      vmid: input.vmid,
      machineProfile: input.machineProfile,
    });

    const failed =
      result.results.some(
        (compareResult) => compareResult.status !== 'match',
      ) || vmidExitCode(result.vmidIssues, options) !== 0;
    hasFailure = hasFailure || failed;

    if (options.json) {
      reports.push({
        name: fixture.name,
        summary: summarizeCompareResults(result.results),
        vmidIssues: result.vmidIssues,
        results: result.results,
      });
    } else {
      printData(chalk.cyan(`\n${fixture.name}`));
      printVmidValidation(result.vmidIssues, Boolean(input.vmid));
      printFileLifecycleIssues(result.fileLifecycleIssues);
      printCompareResults(result.results);
    }

    allResults.push(
      ...result.results.map((compareResult) => ({
        ...compareResult,
        file: `${fixture.name}/${compareResult.file}`,
      })),
    );
  }

  await maybeWriteReport(options, allResults);

  if (options.json) {
    printData(
      JSON.stringify({ fixtures: reports, failed: hasFailure }, null, 2),
    );
  }

  return hasFailure ? 1 : 0;
}
