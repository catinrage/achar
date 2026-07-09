#!/usr/bin/env bun

import { existsSync, statSync, unwatchFile, watchFile } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import cliSpinners from 'cli-spinners';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { listBuiltinPosts, resolveBuiltinPost } from './lib/builtin-posts';
import {
  discoverFixtures,
  loadFixture,
  type ResolvedFixture,
} from './lib/fixture';
import { Logger } from './lib/logger';
import {
  loadMachineProfile,
  type MachineProfile,
  validateMachineProfileCompatibility,
} from './lib/machine-profile';
import type { EventData } from './lib/parser';
import {
  formatPostLintIssues,
  lintPostSource,
  lintUnhandledEvents,
} from './lib/post-lint';
import { loadPost, type RegisterPost } from './lib/post-loader';
import {
  type CompareOptions,
  compareAgainstReference,
  deriveProgramName,
  formatCompareResults,
  generatePostFiles,
  generatePostProgram,
  parseTraceFile,
  testPost,
  writeGeneratedFiles,
  writeHtmlReport,
} from './lib/post-test';
import { Program } from './lib/program';
import {
  formatVmidSummary,
  formatVmidValidation,
  generateVmidTraceTypes,
  parseVmidFile,
  type VmidDefinition,
  type VmidValidationIssue,
  validateTraceAgainstVmid,
} from './lib/vmid';

interface CliOptions {
  all?: boolean;
  allReferenceFiles?: boolean;
  fixture?: boolean;
  driver?: boolean;
  event?: string;
  file?: string;
  force?: boolean;
  interactive?: boolean;
  json?: boolean;
  interfaceName?: string;
  maxDiffs?: number;
  name?: string;
  machineProfile?: string;
  normalizeTimestamps?: boolean;
  out?: string;
  post?: string;
  programName?: string;
  reference?: string;
  report?: string;
  strict?: boolean;
  strictVmid?: boolean;
  trace?: string;
  update?: boolean;
  vmid?: string;
  watch?: boolean;
}

interface RunInput {
  fixture?: ResolvedFixture;
  events: EventData[];
  tracePath: string;
  referenceDir?: string;
  outputDir?: string;
  programName: string;
  registerPost: RegisterPost;
  vmid?: VmidDefinition;
  machineProfile?: MachineProfile;
  vmidIssues: VmidValidationIssue[];
}

interface GenerateRequest {
  target: string;
  options: CliOptions;
}

Logger.setGlobalOptions({ enabled: false });

const VERSION = '0.1.0';
const cli = new Command();

cli
  .name('achar')
  .usage('<command> [options]')
  .description('SolidCAM trace post-processing tools.')
  .version(VERSION)
  .showHelpAfterError();

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
      console.log(chalk.green(`Parsed ${events.length} events -> ${outPath}`));
      return 0;
    }),
  );

cli
  .command('vmid <vmid>')
  .description('Inspect a SolidCAM VMID file.')
  .option('--json', 'Print parsed VMID data as JSON.')
  .action(
    runCommand(async (vmidPath: string, options: CliOptions) => {
      const vmid = await parseVmidFile(vmidPath);

      if (options.json) {
        console.log(JSON.stringify(vmid, null, 2));
      } else {
        console.log(chalk.green(formatVmidSummary(vmid)));
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
        console.log(chalk.green(`Generated VMID types -> ${options.out}`));
      } else {
        console.log(source);
      }
      return 0;
    }),
  );

cli
  .command('lint-post <file>')
  .description('Check an Achar post for maintainability issues.')
  .option('--driver', 'Treat the source as a controller driver.')
  .option('--trace <file>', 'Also report trace events without handlers.')
  .action(
    runCommand(async (file: string, options: CliOptions) => {
      const issues = lintPostSource(await readFile(file, 'utf-8'), {
        driverFile: options.driver,
      });
      if (options.trace) {
        const program = new Program();
        (await loadPost(file))(program);
        issues.push(
          ...lintUnhandledEvents(
            await parseTraceFile(options.trace),
            program.registeredEvents(),
          ),
        );
      }
      console.log(formatPostLintIssues(issues));
      return issues.length === 0 ? 0 : 1;
    }),
  );

cli
  .command('explain <trace-or-fixture>')
  .description('Explain which event emitted each command.')
  .option('--post <name-or-file>', 'Post module.')
  .option('--machine-profile <file>', 'Machine profile JSON file.')
  .option('--program-name <name>', 'Program name.')
  .option('--file <name>', 'Filter by generated MPF/SPF file.')
  .option('--event <name>', 'Filter by trace event name.')
  .action(
    runCommand(async (target: string, options: CliOptions) => {
      const input = await resolveInput(target, options);
      const program = generatePostProgram(
        input.events,
        input.programName,
        input.registerPost,
      );
      console.log(
        program.explain({ file: options.file, event: options.event }),
      );
      return 0;
    }),
  );

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
        console.log(`${chalk.green(post.id)}  ${post.name}${aliases}`);
      }

      return 0;
    }),
  );

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
      console.log(
        chalk.green(`Created post scaffold -> ${path.resolve(directory)}`),
      );
      return 0;
    }),
  );

cli
  .command('validate <trace-or-fixture>')
  .description(
    'Validate trace inputs, including VMID user parameters and axes.',
  )
  .option('--vmid <file>', 'VMID file. Fixtures can provide this.')
  .option('--machine-profile <file>', 'Machine profile JSON file.')
  .option('--strict-vmid', 'Treat VMID warnings as failures.')
  .action(
    runCommand(async (target: string, options: CliOptions) => {
      const input = await resolveInput(target, options);
      printVmidValidation(input.vmidIssues, Boolean(input.vmid));
      return vmidExitCode(input.vmidIssues, options);
    }),
  );

cli
  .command('generate [trace-or-fixture]')
  .description('Generate MPF/SPF files from a trace or fixture.')
  .option('--out <directory>', 'Output directory.')
  .option('--program-name <name>', 'Program name for the main MPF.')
  .option(
    '--post <name-or-file>',
    'Post module. Built-ins: default, siemens-828d.',
  )
  .option('--vmid <file>', 'VMID file. Fixtures can provide this.')
  .option('--machine-profile <file>', 'Machine profile JSON file.')
  .option('--strict-vmid', 'Treat VMID warnings as failures.')
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
            generateFromEvents(
              input.events,
              input.programName,
              input.registerPost,
            ),
        );
        await writeGeneratedFiles(files, input.outputDir ?? '');
        const elapsed = formatDuration(performance.now() - startedAt);
        console.log(
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

cli
  .command('parity <trace-or-fixture>')
  .description('Generate files and compare them against reference G-code.')
  .option('--reference <directory>', 'Reference G-code directory.')
  .option('--out <directory>', 'Generated output directory.')
  .option('--program-name <name>', 'Program name for the main MPF.')
  .option(
    '--post <name-or-file>',
    'Post module. Built-ins: default, siemens-828d.',
  )
  .option(
    '--all-reference-files',
    'Compare every MPF/SPF in the reference directory.',
  )
  .option('--strict', 'Disable normalization and fail on any mismatch.')
  .option(
    '--no-normalize-timestamps',
    'Do not normalize legacy post timestamps.',
  )
  .option(
    '--max-diffs <count>',
    'Maximum line diffs to print per file.',
    parsePositiveInteger,
    5,
  )
  .option('--report <file>', 'Write an HTML diff report.')
  .option('--vmid <file>', 'VMID file. Fixtures can provide this.')
  .option('--machine-profile <file>', 'Machine profile JSON file.')
  .option('--strict-vmid', 'Treat VMID warnings as failures.')
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

        const files = generateFromEvents(
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
        printCompareResults(results);

        const hasDifferences = results.some(
          (result) => result.status !== 'match',
        );
        return options.strict && hasDifferences ? 1 : 0;
      };

      return options.watch ? watchRun(target, options, runOnce) : runOnce();
    }),
  );

cli
  .command('test <trace-fixture-or-root>')
  .description(
    'Run golden-output post regression tests. Fails on any mismatch.',
  )
  .option('--reference <directory>', 'Reference G-code directory.')
  .option('--out <directory>', 'Generated output directory.')
  .option('--program-name <name>', 'Program name for the main MPF.')
  .option(
    '--post <name-or-file>',
    'Post module. Built-ins: default, siemens-828d.',
  )
  .option('--all', 'Discover and run every fixture under the target directory.')
  .option(
    '--all-reference-files',
    'Compare every MPF/SPF in the reference directory.',
  )
  .option('--strict', 'Disable normalization.')
  .option(
    '--no-normalize-timestamps',
    'Do not normalize legacy post timestamps.',
  )
  .option(
    '--max-diffs <count>',
    'Maximum line diffs to print per file.',
    parsePositiveInteger,
    5,
  )
  .option('--update', 'Update reference G-code with generated output.')
  .option('--report <file>', 'Write an HTML diff report.')
  .option('--vmid <file>', 'VMID file. Fixtures can provide this.')
  .option('--machine-profile <file>', 'Machine profile JSON file.')
  .option('--strict-vmid', 'Treat VMID warnings as failures.')
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

        printVmidValidation(result.vmidIssues, Boolean(input.vmid));
        await maybeWriteReport(options, result.results);
        printCompareResults(result.results);

        return result.results.some(
          (compareResult) => compareResult.status !== 'match',
        ) || vmidExitCode(result.vmidIssues, options) !== 0
          ? 1
          : 0;
      };

      return options.watch ? watchRun(target, options, runOnce) : runOnce();
    }),
  );

cli.helpCommand(true);

function runCommand<Args extends unknown[]>(
  handler: (...args: Args) => Promise<number> | number,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    const code = await handler(...args);
    process.exitCode = typeof code === 'number' ? code : 0;
  };
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

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got "${value}".`);
  }
  return parsed;
}

async function withSpinner<T>(
  message: string,
  task: () => Promise<T> | T,
): Promise<T> {
  const spinner = new TerminalSpinner(message);
  spinner.start();
  try {
    return await task();
  } finally {
    spinner.stop();
  }
}

class TerminalSpinner {
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly message: string) {}

  start(): void {
    if (process.stderr.isTTY !== true) return;

    const spinner = cliSpinners.dots;
    const render = (): void => {
      const frame = spinner.frames[this.frameIndex % spinner.frames.length];
      this.frameIndex++;
      process.stderr.write(`\r${chalk.cyan(frame)} ${this.message}`);
    };

    render();
    this.timer = setInterval(render, spinner.interval);
  }

  stop(): void {
    if (!this.timer) return;

    clearInterval(this.timer);
    this.timer = undefined;
    const width = process.stderr.columns ?? 80;
    process.stderr.write(`\r${' '.repeat(width)}\r`);
  }
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(1, Math.round(milliseconds))}ms`;
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
}

async function runAllFixtures(
  target: string,
  options: CliOptions,
): Promise<number> {
  const fixtures = await discoverFixtures(target);
  const allResults = [];
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

    console.log(chalk.cyan(`\n${fixture.name}`));
    printVmidValidation(result.vmidIssues, Boolean(input.vmid));
    printCompareResults(result.results);
    hasFailure =
      hasFailure ||
      result.results.some(
        (compareResult) => compareResult.status !== 'match',
      ) ||
      vmidExitCode(result.vmidIssues, options) !== 0;
    allResults.push(
      ...result.results.map((compareResult) => ({
        ...compareResult,
        file: `${fixture.name}/${compareResult.file}`,
      })),
    );
  }

  await maybeWriteReport(options, allResults);
  return hasFailure ? 1 : 0;
}

async function resolveInput(
  target: string,
  options: CliOptions,
  requirements: {
    fixture?: ResolvedFixture;
    requireOut?: boolean;
    requireReference?: boolean;
  } = {},
): Promise<RunInput> {
  const fixture =
    requirements.fixture ??
    (isFixtureTarget(target) ? await loadFixture(target) : undefined);
  const tracePath = fixture?.trace ?? target;
  const referenceDir =
    typeof options.reference === 'string'
      ? options.reference
      : fixture?.reference;
  const outputDir =
    typeof options.out === 'string' ? options.out : fixture?.out;
  const programName =
    typeof options.programName === 'string'
      ? options.programName
      : (fixture?.programName ?? deriveProgramName(tracePath));
  const loadedPost = await loadPost(
    typeof options.post === 'string' ? options.post : fixture?.post,
  );
  const vmid = await loadVmid(options, fixture);
  const machineProfile = await loadProfile(options, fixture);
  const traceEvents = await parseTraceFile(tracePath);
  const registerPost: RegisterPost = (program, context = {}) =>
    loadedPost(program, {
      ...context,
      machineProfile: context.machineProfile ?? machineProfile,
    });
  const vmidIssues = vmid ? validateTraceAgainstVmid(traceEvents, vmid) : [];
  vmidIssues.push(
    ...validateMachineProfileCompatibility(machineProfile, traceEvents, vmid),
  );

  if (requirements.requireReference && !referenceDir) {
    throw new Error('Missing required option: --reference');
  }

  if (requirements.requireOut && !outputDir) {
    throw new Error('Missing required option: --out');
  }

  return {
    fixture,
    events: traceEvents,
    tracePath,
    referenceDir,
    outputDir,
    programName,
    registerPost,
    vmid,
    machineProfile,
    vmidIssues,
  };
}

async function loadVmid(
  options: CliOptions,
  fixture?: ResolvedFixture,
): Promise<VmidDefinition | undefined> {
  const vmidPath =
    typeof options.vmid === 'string' ? options.vmid : fixture?.vmid;
  return vmidPath ? parseVmidFile(vmidPath) : undefined;
}

async function loadProfile(
  options: CliOptions,
  fixture?: ResolvedFixture,
): Promise<MachineProfile | undefined> {
  const profilePath =
    typeof options.machineProfile === 'string'
      ? options.machineProfile
      : fixture?.machineProfile;
  return profilePath ? loadMachineProfile(profilePath) : undefined;
}

function generateFromEvents(
  events: EventData[],
  programName: string,
  registerPost: RegisterPost,
): ReturnType<typeof generatePostFiles> {
  return generatePostFiles(events, programName, registerPost);
}

function compareOptions(options: CliOptions): CompareOptions {
  return {
    allReferenceFiles: options.allReferenceFiles === true,
    maxDiffsPerFile: options.maxDiffs ?? 5,
    normalizeTimestamps:
      options.strict === true ? false : options.normalizeTimestamps !== false,
    strict: options.strict === true,
  };
}

function isFixtureTarget(target: string): boolean {
  const resolved = path.resolve(target);
  return (
    existsSync(resolved) &&
    statSync(resolved).isDirectory() &&
    existsSync(path.join(resolved, 'achar.fixture.json'))
  );
}

async function maybeWriteReport(
  options: CliOptions,
  results: Awaited<ReturnType<typeof compareAgainstReference>>,
): Promise<void> {
  if (typeof options.report === 'string') {
    await writeHtmlReport(results, path.resolve(options.report));
    console.log(chalk.green(`Report written -> ${options.report}`));
  }
}

function printCompareResults(
  results: Awaited<ReturnType<typeof compareAgainstReference>>,
): void {
  const hasDifferences = results.some((result) => result.status !== 'match');
  const output = formatCompareResults(results);
  console.log(hasDifferences ? chalk.red(output) : chalk.green(output));
}

function printVmidValidation(
  issues: VmidValidationIssue[],
  hasVmid: boolean,
): void {
  if (!hasVmid) {
    console.log(chalk.dim('No VMID supplied; skipping VMID validation'));
    return;
  }

  if (issues.length === 0) {
    console.log(chalk.green('VMID validation passed'));
    return;
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const color = errors.length > 0 ? chalk.red : chalk.yellow;
  console.log(color(formatVmidValidation(issues)));
}

function vmidExitCode(
  issues: VmidValidationIssue[],
  options: CliOptions,
): number {
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const hasWarnings = issues.some((issue) => issue.severity === 'warning');
  return hasErrors || (options.strictVmid === true && hasWarnings) ? 1 : 0;
}

async function watchRun(
  target: string,
  options: CliOptions,
  runOnce: () => Promise<number>,
): Promise<number> {
  let running = false;
  let pending = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const execute = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }

    running = true;
    try {
      process.exitCode = await runOnce();
    } catch (error) {
      process.exitCode = 1;
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
    } finally {
      running = false;
      if (pending) {
        pending = false;
        await execute();
      }
    }
  };
  const schedule = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      console.log(chalk.dim('\nChange detected; rerunning...'));
      void execute();
    }, 100);
  };

  await execute();

  const watchPaths = await watchablePaths(target, options);
  for (const watchPath of watchPaths) {
    watchFile(watchPath, { interval: 500 }, (current, previous) => {
      if (
        current.mtimeMs !== previous.mtimeMs ||
        current.size !== previous.size
      ) {
        schedule();
      }
    });
  }
  console.log(
    chalk.cyan(`Watching ${watchPaths.length} path(s). Press Ctrl+C to stop.`),
  );

  return new Promise((resolve) => {
    process.once('SIGINT', () => {
      for (const watchPath of watchPaths) unwatchFile(watchPath);
      resolve(Number(process.exitCode ?? 0));
    });
  });
}

async function watchablePaths(
  target: string,
  options: CliOptions,
): Promise<string[]> {
  const paths = new Set<string>();

  await addExistingWatchPath(paths, target);

  if (options.all === true) {
    try {
      for (const fixture of await discoverFixtures(target)) {
        await addFixtureWatchPaths(paths, fixture);
      }
    } catch {
      // The command itself will report fixture discovery errors.
    }
  } else if (isFixtureTarget(target)) {
    await addFixtureWatchPaths(paths, await loadFixture(target));
  }

  if (typeof options.reference === 'string')
    await addExistingWatchPath(paths, options.reference);
  if (typeof options.vmid === 'string')
    await addExistingWatchPath(paths, options.vmid);
  if (typeof options.machineProfile === 'string')
    await addExistingWatchPath(paths, options.machineProfile);
  if (typeof options.post === 'string' && !resolveBuiltinPost(options.post)) {
    await addExistingWatchPath(paths, options.post);
  }

  return [...paths];
}

async function addFixtureWatchPaths(
  paths: Set<string>,
  fixture: ResolvedFixture,
): Promise<void> {
  await addExistingWatchPath(
    paths,
    path.join(fixture.root, 'achar.fixture.json'),
  );
  await addExistingWatchPath(paths, fixture.trace);
  await addExistingWatchPath(paths, fixture.reference);
  if (fixture.vmid) await addExistingWatchPath(paths, fixture.vmid);
  if (fixture.machineProfile) {
    await addExistingWatchPath(paths, fixture.machineProfile);
  }
  if (fixture.post && !resolveBuiltinPost(fixture.post)) {
    await addExistingWatchPath(paths, fixture.post);
  }
}

async function addExistingWatchPath(
  paths: Set<string>,
  filePath: string,
): Promise<void> {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) return;

  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    paths.add(resolved);
    return;
  }

  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(MPF|SPF|json|vmid|ts|js)$/i.test(entry.name)) continue;

    paths.add(path.join(resolved, entry.name));
  }
}

async function initPost(directory: string, options: CliOptions): Promise<void> {
  const root = path.resolve(directory);
  const id = path.basename(root);
  const name = options.name ?? id;

  await mkdir(root, { recursive: true });
  await writeScaffoldFile(
    path.join(root, 'index.ts'),
    postTemplate(name),
    options,
  );
  await writeScaffoldFile(
    path.join(root, 'post.config.ts'),
    postConfigTemplate(id, name),
    options,
  );
  await writeScaffoldFile(
    path.join(root, 'driver.ts'),
    postDriverTemplate(id),
    options,
  );
  await writeScaffoldFile(
    path.join(root, 'policy.ts'),
    postPolicyTemplate(name),
    options,
  );
  await writeScaffoldFile(
    path.join(root, 'README.md'),
    postReadmeTemplate(name),
    options,
  );

  if (options.fixture) {
    await writeScaffoldFile(
      path.join(root, 'achar.fixture.json'),
      fixtureTemplate(root, options),
      options,
    );
  }
}

async function writeScaffoldFile(
  filePath: string,
  content: string,
  options: CliOptions,
): Promise<void> {
  if (existsSync(filePath) && options.force !== true) {
    throw new Error(
      `Refusing to overwrite ${filePath}; pass --force to replace it.`,
    );
  }

  await writeFile(filePath, content);
}

function postTemplate(_name: string): string {
  return `import { createPostContext, definePost, type Program } from 'achar';
import { controllerDriver } from './driver';
import { postPolicy } from './policy';

export function registerPost(program: Program): void {
  const context = createPostContext(() => ({ jobs: 0 }));
  const post = definePost(program, context);

  post.on('StartOfFile', ($, params) => {
    $.Comment(postPolicy.title);
    $.Comment(\`Part Name: \${params.part_name}\`);
  });

  post.on('StartOfJob', () => {
    context.state.jobs++;
  });

  post.on('EndOfFile', ($) => {
    $.driver(controllerDriver).ProgramEnd();
  });
}

export default registerPost;
`;
}

function postDriverTemplate(id: string): string {
  return `import { defineDriver, type Builder } from 'achar';

export const controllerDriver = defineDriver({
  id: '${escapeTemplateValue(id)}',
  capabilities: ['program.end'],
  create(builder: Builder) {
    return {
      ProgramEnd() {
        builder.ProgramEndAndRewind({ reason: 'controller program end' });
      },
    };
  },
});
`;
}

function postPolicyTemplate(name: string): string {
  return `import { definePostPolicy } from 'achar';

export const postPolicy = definePostPolicy({
  title: '${escapeTemplateValue(name)}',
});
`;
}

function postConfigTemplate(id: string, name: string): string {
  return `export default {
  id: '${escapeTemplateValue(id)}',
  name: '${escapeTemplateValue(name)}',
  register: './index.ts',
};
`;
}

function postReadmeTemplate(name: string): string {
  return `# ${name}

Run this post against a fixture:

\`\`\`bash
achar test . --post ./index.ts
\`\`\`
`;
}

function fixtureTemplate(root: string, options: CliOptions): string {
  const manifest = {
    trace: relativeFixturePath(root, options.trace ?? 'trace.MPF'),
    reference: relativeFixturePath(root, options.reference ?? 'reference'),
    programName: options.programName,
    post: './index.ts',
    vmid: options.vmid ? relativeFixturePath(root, options.vmid) : undefined,
    machineProfile: options.machineProfile
      ? relativeFixturePath(root, options.machineProfile)
      : undefined,
  };

  return `${JSON.stringify(dropUndefined(manifest), null, 2)}\n`;
}

function relativeFixturePath(root: string, filePath: string): string {
  return path.relative(root, path.resolve(filePath)).replaceAll('\\', '/');
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}

function escapeTemplateValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function requireString(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required option: --${name}`);
  }

  return value;
}

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
