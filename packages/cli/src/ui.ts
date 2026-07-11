import type { CompareResult, VmidValidationIssue } from '@achar/core';
import { formatCompareResults, formatVmidValidation } from '@achar/core';
import chalk from 'chalk';
import cliSpinners from 'cli-spinners';

/**
 * Stream discipline: stdout carries command output (data, tables, JSON);
 * stderr carries progress, diagnostics, and errors so pipelines like
 * `achar parse ... | jq` never see human chatter.
 */
export function printData(message: string): void {
  console.log(message);
}

export function printInfo(message: string): void {
  console.error(message);
}

export function printError(message: string): void {
  console.error(chalk.red(message));
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(1, Math.round(milliseconds))}ms`;
  }

  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
}

export async function withSpinner<T>(
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

export function printCompareResults(results: CompareResult[]): void {
  const hasDifferences = results.some((result) => result.status !== 'match');
  const output = formatCompareResults(results);
  printData(hasDifferences ? chalk.red(output) : chalk.green(output));
}

export function printVmidValidation(
  issues: VmidValidationIssue[],
  hasVmid: boolean,
): void {
  if (!hasVmid) {
    printInfo(chalk.dim('No VMID supplied; skipping VMID validation'));
    return;
  }

  if (issues.length === 0) {
    printInfo(chalk.green('VMID validation passed'));
    return;
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const color = errors.length > 0 ? chalk.red : chalk.yellow;
  printInfo(color(formatVmidValidation(issues)));
}
