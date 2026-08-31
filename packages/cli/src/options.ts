import type { Command } from 'commander';

export interface CliOptions {
  all?: boolean;
  check?: string;
  gcode?: string;
  listChecks?: boolean;
  minSeverity?: string;
  allReferenceFiles?: boolean;
  dataDir?: string;
  fixture?: boolean;
  driver?: boolean;
  event?: string;
  file?: string;
  force?: boolean;
  ignoreNumbering?: boolean;
  interactive?: boolean;
  json?: boolean;
  keepAllTools?: boolean;
  interfaceName?: string;
  maxDiffs?: number;
  name?: string;
  host?: string;
  machineProfile?: string;
  maxBody?: number;
  maxParses?: number;
  normalizeTimestamps?: boolean;
  out?: string;
  port?: number;
  post?: string;
  programName?: string;
  reference?: string;
  report?: string;
  retentionDays?: number;
  setups?: string;
  strict?: boolean;
  strictVmid?: boolean;
  token?: string;
  trace?: string;
  update?: boolean;
  vmid?: string;
  watch?: boolean;
  webRoot?: string;
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

/**
 * `--setups`, `--keep-all-tools` for commands that can post a subset of a
 * trace. Deliberately absent from `parity` and `test`: those compare against a
 * reference for the whole program, so a subset has nothing to match, and an
 * undeclared flag is rejected with a clear message.
 */
export function withSetupSelectionOptions(command: Command): Command {
  return command
    .option(
      '--setups <selection>',
      'Post only these setups: indices, ranges, or names (e.g. 1,3 or 1-3,7 or Setup1). Run `achar setups <trace>` to list them.',
    )
    .option(
      '--keep-all-tools',
      'With --setups, keep every tool definition instead of pruning to the tools the selected setups load.',
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
    .option(
      '--ignore-numbering',
      'Ignore N-number prefixes so block-number drift does not count as a difference.',
    )
    .option('--report <file>', 'Write an HTML diff report.')
    .option('--json', 'Print machine-readable JSON results on stdout.');
}
