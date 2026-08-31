import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Finding, Severity, VerifyResult } from '@achar/core';
import {
  CHECKS,
  deriveIntent,
  loadFixture,
  loadProgramSource,
  Parser,
  severityRank,
  verifyProgram,
} from '@achar/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { CliOptions } from '../options';
import { runCommand } from '../runner';
import { printInfo } from '../ui';

/**
 * `achar verify` — does this G-code do what the trace asked for?
 *
 * Distinct from `achar test`, which asks whether output matches a recorded
 * reference byte for byte. This asks a question no reference can answer:
 * whether the program, read as a machine would read it, cuts the part the
 * trace describes. It works on legacy output as readily as on achar's, so it
 * can audit programs posted long before achar existed.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  scrap: 'SCRAP',
  wrong: 'WRONG',
  suspect: 'SUSPECT',
  info: 'INFO',
};

function paint(severity: Severity, text: string): string {
  if (severity === 'scrap') return chalk.bgRed.white.bold(text);
  if (severity === 'wrong') return chalk.red.bold(text);
  if (severity === 'suspect') return chalk.yellow(text);
  return chalk.dim(text);
}

export function registerVerifyCommand(cli: Command): void {
  cli
    .command('verify [trace-or-fixture]')
    .description(
      'Check emitted G-code against what the trace says the program must do.',
    )
    .option(
      '--gcode <directory>',
      'Directory of emitted G-code. Defaults to the fixture reference.',
    )
    .option('--check <ids>', 'Run only these checks (comma separated).')
    .option(
      '--min-severity <level>',
      'Report findings at or above this level: scrap, wrong, suspect, info.',
    )
    .option('--list-checks', 'Print the check catalog and exit.')
    .option('--json', 'Emit findings as JSON.')
    .action(
      runCommand(async (target: string | undefined, options: CliOptions) => {
        if (options.listChecks === true) {
          for (const check of CHECKS) {
            console.log(
              `${paint(check.severity, SEVERITY_LABEL[check.severity].padEnd(7))}  ${chalk.bold(check.id.padEnd(24))}  ${check.describe}`,
            );
          }
          return 0;
        }

        if (!target) {
          throw new Error("missing required argument 'trace-or-fixture'");
        }

        const { tracePath, gcodeDirectory, programName } = await resolveTargets(
          target,
          options,
        );

        const events = new Parser(await readFile(tracePath, 'utf8')).parse();
        const intent = deriveIntent(events);
        const source = await loadProgramSource(gcodeDirectory, programName);

        const result = verifyProgram(intent, source, {
          only:
            typeof options.check === 'string'
              ? options.check.split(',').map((id) => id.trim())
              : undefined,
          minimumSeverity: options.minSeverity as Severity | undefined,
        });

        if (options.json === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          report(result, source.mainName);
        }

        // A finding that can scrap a part or is outright wrong fails the
        // command; a suspicion is reported and does not.
        return result.findings.some(
          (finding) => severityRank(finding.severity) >= severityRank('wrong'),
        )
          ? 1
          : 0;
      }),
    );
}

async function resolveTargets(
  target: string,
  options: CliOptions,
): Promise<{
  tracePath: string;
  gcodeDirectory: string;
  programName: string;
}> {
  const gcodeOption =
    typeof options.gcode === 'string' ? options.gcode : undefined;

  // A fixture knows both halves: the trace, and the reference the legacy post
  // produced from it. That pairing is the common case and worth not retyping.
  try {
    const fixture = await loadFixture(target);
    return {
      tracePath: fixture.trace,
      gcodeDirectory: gcodeOption ?? fixture.reference,
      programName: path.basename(fixture.trace),
    };
  } catch {
    if (!gcodeOption) {
      throw new Error(
        'Pass --gcode <directory> when the target is a trace file rather than a fixture.',
      );
    }
    return {
      tracePath: target,
      gcodeDirectory: gcodeOption,
      programName: path.basename(target),
    };
  }
}

function report(result: VerifyResult, mainName: string): void {
  printInfo(
    chalk.dim(
      `${mainName}: ${result.jobCount} job(s), ${result.callCount} call(s), ${result.executedLines} executed line(s)`,
    ),
  );

  if (!result.aligned) {
    printInfo(
      chalk.yellow(
        'Jobs and subprogram calls do not line up; per-job checks were skipped.',
      ),
    );
  }

  if (result.findings.length === 0) {
    printInfo(
      chalk.green(
        `No findings. ${result.checksRun.length} check(s) passed clean.`,
      ),
    );
    return;
  }

  for (const finding of result.findings) print(finding);

  const counts = new Map<Severity, number>();
  for (const finding of result.findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  const summary = [...counts]
    .sort((a, b) => severityRank(b[0]) - severityRank(a[0]))
    .map(([severity, count]) => paint(severity, `${count} ${severity}`))
    .join(chalk.dim(' · '));
  printInfo(`\n${summary}`);
}

function print(finding: Finding): void {
  const repeats =
    finding.occurrences && finding.occurrences > 1
      ? chalk.dim(` ×${finding.occurrences}`)
      : '';
  const where = [finding.file ?? 'main', finding.line]
    .filter((part) => part !== undefined)
    .join(':');

  console.log(
    `${paint(finding.severity, ` ${SEVERITY_LABEL[finding.severity]} `)} ${chalk.bold(finding.check)}${repeats}  ${chalk.dim(where)}`,
  );
  console.log(`  ${finding.message}`);
  if (finding.detail) console.log(chalk.dim(`  ${finding.detail}`));
}
