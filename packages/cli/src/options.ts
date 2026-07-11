import type { Command } from 'commander';

export interface CliOptions {
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
  workspace?: string;
  logs?: boolean;
}

export function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got "${value}".`);
  }
  return parsed;
}

/** `--vmid`, `--machine-profile`, `--strict-vmid` shared by generation-family commands. */
export function withVmidOptions(command: Command): Command {
  return command
    .option('--vmid <file>', 'VMID file. Fixtures can provide this.')
    .option('--machine-profile <file>', 'Machine profile JSON file.')
    .option('--strict-vmid', 'Treat VMID warnings as failures.');
}

/** `--out`, `--program-name`, `--post` shared by generation-family commands. */
export function withGenerationOptions(command: Command): Command {
  return command
    .option('--out <directory>', 'Output directory.')
    .option('--program-name <name>', 'Program name for the main MPF.')
    .option(
      '--post <name-or-file>',
      'Post module. Built-ins: default, siemens-828d.',
    );
}

/** Comparison flags shared by `parity` and `test`. */
export function withCompareOptions(command: Command): Command {
  return command
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
    .option('--json', 'Print machine-readable JSON results on stdout.');
}
