import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  deriveProgramName,
  generatePostFiles,
  loadFixture,
  writeGeneratedFiles,
} from '@achar/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import inquirer from 'inquirer';
import {
  dropUndefined,
  emptyToUndefined,
  isFixtureTarget,
  isInteractiveTerminal,
  resolveInput,
  vmidExitCode,
} from '../inputs';
import {
  type CliOptions,
  withGenerationOptions,
  withVmidOptions,
} from '../options';
import { runCommand } from '../runner';
import {
  formatDuration,
  printInfo,
  printVmidValidation,
  withSpinner,
} from '../ui';
import { watchRun } from '../watch';

interface GenerateRequest {
  target: string;
  options: CliOptions;
}

export function registerGenerateCommand(cli: Command): void {
  withVmidOptions(
    withGenerationOptions(
      cli
        .command('generate [trace-or-fixture]')
        .description('Generate MPF/SPF files from a trace or fixture.'),
    ),
  )
    .option('--watch', 'Watch inputs and regenerate on changes.')
    .option('--interactive', 'Prompt for generate options.')
    .action(
      runCommand(async (target: string | undefined, options: CliOptions) => {
        const generateRequest = await collectGenerateRequest(target, options);
        const runOnce = async (): Promise<number> => {
          const startedAt = performance.now();
          const input = await resolveInput(
            generateRequest.target,
            generateRequest.options,
            {
              requireOut: true,
            },
          );
          printVmidValidation(input.vmidIssues, Boolean(input.vmid));
          const vmidCode = vmidExitCode(
            input.vmidIssues,
            generateRequest.options,
          );
          if (vmidCode !== 0) return vmidCode;

          const files = await withSpinner(
            `Generating ${input.programName}`,
            async () =>
              generatePostFiles(
                input.events,
                input.programName,
                input.registerPost,
              ),
          );
          await writeGeneratedFiles(files, input.outputDir ?? '');
          const elapsed = formatDuration(performance.now() - startedAt);
          printInfo(
            chalk.green(
              `Generated ${files.length} files -> ${input.outputDir} in ${elapsed}`,
            ),
          );
          return 0;
        };

        return generateRequest.options.watch
          ? watchRun(generateRequest.target, generateRequest.options, runOnce)
          : runOnce();
      }),
    );
}

async function collectGenerateRequest(
  target: string | undefined,
  options: CliOptions,
): Promise<GenerateRequest> {
  const shouldPrompt = options.interactive === true || !target;
  if (!shouldPrompt) {
    return { target, options };
  }

  if (!isInteractiveTerminal()) {
    if (!target) {
      throw new Error(
        'Missing required argument: trace-or-fixture. Run interactively in a TTY or pass the target as an argument.',
      );
    }
    return { target, options };
  }

  const answers: Partial<CliOptions> & { target?: string } = {};
  if (!target) {
    const targetAnswer = await inquirer.prompt<{ target: string }>([
      {
        type: 'input',
        name: 'target',
        message: 'Trace file or fixture directory',
        validate(value: string) {
          return value.trim().length > 0
            ? true
            : 'Enter a trace file or fixture directory.';
        },
      },
    ]);
    answers.target = targetAnswer.target.trim();
  }

  const resolvedTarget = answers.target ?? target;
  if (!resolvedTarget) {
    throw new Error('Missing required argument: trace-or-fixture.');
  }

  const fixture = isFixtureTarget(resolvedTarget)
    ? await loadFixture(resolvedTarget)
    : undefined;
  const tracePath = fixture?.trace ?? resolvedTarget;
  const defaultProgramName = deriveProgramName(tracePath);
  const defaultOut =
    options.out ?? fixture?.out ?? path.join('generated', defaultProgramName);

  const promptAnswers = await inquirer.prompt<Partial<CliOptions>>([
    {
      type: 'input',
      name: 'out',
      message: 'Output directory',
      default: defaultOut,
      when: options.interactive === true || !options.out,
      validate(value: string) {
        return value.trim().length > 0 ? true : 'Enter an output directory.';
      },
      filter(value: string) {
        return value.trim();
      },
    },
    {
      type: 'input',
      name: 'programName',
      message: 'Program name',
      default:
        options.programName ?? fixture?.programName ?? defaultProgramName,
      when: options.interactive === true || !target,
      filter(value: string) {
        return value.trim();
      },
    },
    {
      type: 'input',
      name: 'post',
      message: 'Post module',
      default: options.post ?? fixture?.post ?? 'default',
      when: options.interactive === true || !target,
      filter(value: string) {
        return emptyToUndefined(value);
      },
    },
    {
      type: 'input',
      name: 'vmid',
      message: 'VMID file',
      default: options.vmid ?? fixture?.vmid ?? '',
      when: options.interactive === true || !target,
      filter(value: string) {
        return emptyToUndefined(value);
      },
    },
    {
      type: 'input',
      name: 'machineProfile',
      message: 'Machine profile JSON',
      default: options.machineProfile ?? fixture?.machineProfile ?? '',
      when: options.interactive === true || !target,
      filter(value: string) {
        return emptyToUndefined(value);
      },
    },
    {
      type: 'confirm',
      name: 'strictVmid',
      message: 'Fail on VMID warnings',
      default: options.strictVmid === true,
      when: options.interactive === true || !target,
    },
    {
      type: 'confirm',
      name: 'watch',
      message: 'Watch inputs and regenerate',
      default: options.watch === true,
      when: options.interactive === true || !target,
    },
  ]);

  return {
    target: resolvedTarget,
    options: {
      ...options,
      ...dropUndefined(promptAnswers),
      interactive: options.interactive,
    },
  };
}
