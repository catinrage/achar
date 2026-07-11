import type { Command } from 'commander';
import { resolveInput, vmidExitCode } from '../inputs';
import { type CliOptions, withVmidOptions } from '../options';
import { runCommand } from '../runner';
import { printData, printVmidValidation } from '../ui';

export function registerValidateCommand(cli: Command): void {
  withVmidOptions(
    cli
      .command('validate <trace-or-fixture>')
      .description(
        'Validate trace inputs, including VMID user parameters and axes.',
      ),
  )
    .option('--json', 'Print machine-readable JSON results on stdout.')
    .action(
      runCommand(async (target: string, options: CliOptions) => {
        const input = await resolveInput(target, options);
        const exitCode = vmidExitCode(input.vmidIssues, options);

        if (options.json) {
          printData(
            JSON.stringify(
              {
                vmidSupplied: Boolean(input.vmid),
                eventCount: input.events.length,
                issues: input.vmidIssues,
                exitCode,
              },
              null,
              2,
            ),
          );
          return exitCode;
        }

        printVmidValidation(input.vmidIssues, Boolean(input.vmid));
        return exitCode;
      }),
    );
}
