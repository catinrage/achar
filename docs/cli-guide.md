# Achar CLI Guide

This guide covers day-to-day use of the Achar command line interface. It is
written for post authors, CNC programmers validating output, and maintainers
running regression checks.

Achar converts SolidCAM trace mode output into generated controller files such
as `MPF` and `SPF`, validates trace inputs against VMID metadata, compares
generated files against existing GPP output, and helps scaffold new TypeScript
post modules.

## Quick Start

Install dependencies:

```bash
bun install
```

Run the CLI through the package script:

```bash
bun run achar --help
```

Or run the entrypoint directly while developing:

```bash
bun src/cli.ts --help
```

Generate files from a fixture:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Generate files interactively:

```bash
bun run achar generate
```

Generate files from a raw trace with explicit flags:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --out generated/full \
  --program-name Setup1 \
  --post siemens-828d \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Run the post regression test for a fixture:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Run every fixture under `fixtures/`:

```bash
bun run achar test fixtures --all
```

## CLI Shape

The CLI is named `achar` and has this command surface:

```text
Usage: achar <command> [options]

Commands:
  parse <trace>                 Parse a SolidCAM trace into Achar IR JSON.
  vmid <vmid>                   Inspect a SolidCAM VMID file.
  vmid-types <vmid>             Generate TypeScript trace extensions from a VMID.
  lint-post <file>              Check an Achar post for maintainability issues.
  explain <trace-or-fixture>    Explain which event emitted each command.
  posts                         List built-in post modules.
  init-post <directory>         Create a new Achar post module skeleton.
  validate <trace-or-fixture>   Validate trace inputs, including VMID parameters and axes.
  generate [trace-or-fixture]   Generate MPF/SPF files from a trace or fixture.
  parity <trace-or-fixture>     Generate files and compare them against reference G-code.
  test <trace-fixture-or-root>  Run golden-output post regression tests.
```

Global options:

```text
-V, --version  Print the CLI version.
-h, --help     Print help.
```

Every command supports `--help`:

```bash
bun run achar generate --help
bun run achar test --help
```

## Targets

Most workflow commands take a `trace-or-fixture` target.

A raw trace target is a SolidCAM trace file:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --out generated/full \
  --program-name Setup1 \
  --post siemens-828d
```

A fixture target is a directory containing `achar.fixture.json`:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Fixtures are preferred for repeated work because they store trace, reference,
post, VMID, program name, and output paths together.

## Fixture Manifests

A fixture manifest is named `achar.fixture.json`:

```json
{
  "name": "full-siemens-828d-setup1",
  "trace": "Setup1.MPF",
  "reference": "reference",
  "programName": "Setup1",
  "post": "siemens-828d",
  "out": "../../generated/full-siemens-828d-setup1",
  "vmid": "Siemens_828D_Milling_4A.vmid"
}
```

Fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | Recommended | Human-readable fixture name used in reports and batch output. |
| `trace` | Yes | SolidCAM trace file. Relative paths resolve from the fixture directory. |
| `reference` | For `test` and `parity` | Directory containing expected G-code files. |
| `programName` | No | Name for the main generated program. If omitted, Achar derives it from the trace filename. |
| `post` | No | Built-in post id or path to a post module. Defaults to `default`. |
| `out` | For `generate` and `parity` unless passed as `--out` | Directory for generated files. |
| `vmid` | No | VMID file used for validation. |
| `machineProfile` | No | Machine profile JSON used for machine-specific generation policy. |

CLI flags override fixture fields. For example, this uses the fixture trace,
reference, program name, post, and VMID, but writes output elsewhere:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out /tmp/achar-output
```

## Built-In Posts

List built-in post modules:

```bash
bun run achar posts
```

Current built-ins:

```text
siemens-828d  Siemens 828D Milling 4A aliases: default
```

Use a built-in post by id:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --post siemens-828d
```

Use a custom post by path:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --post ./posts/my-controller/index.ts
```

Post modules must export a register function. The supported shapes include:

```typescript
import type { Program } from 'achar';

export function registerPost(program: Program): void {
  program.on('StartOfFile', ($, params) => {
    $.Comment(`Part Name: ${params.part_name}`);
  });
}

export default registerPost;
```

## Interactive Generate

`generate` is the only command with an interactive form.

Run it without a target:

```bash
bun run achar generate
```

The CLI prompts for:

1. Trace file or fixture directory.
2. Output directory.
3. Program name.
4. Post module.
5. VMID file.
6. Whether VMID warnings should fail the run.
7. Whether to watch inputs and regenerate.

Use `--interactive` to force prompts even when a target is supplied:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --interactive
```

Interactive mode is for local use. In scripts, CI, and automation, pass flags
explicitly.

## Flags-Only Generate

The non-interactive form is suitable for scripts:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --out generated/full \
  --program-name Setup1 \
  --post siemens-828d \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

For a fixture, the command can be shorter because values come from
`achar.fixture.json`:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Useful options:

```text
--out <directory>      Output directory.
--program-name <name>  Program name for the main MPF.
--post <name-or-file>  Built-in post id or post module path.
--vmid <file>          VMID file.
--machine-profile <file>  Machine profile JSON file.
--strict-vmid          Treat VMID warnings as failures.
--watch                Watch inputs and regenerate on changes.
--interactive          Prompt for generate options.
```

`generate` prints a final summary:

```text
VMID validation passed
Generated 25 files -> generated/full in 5.80s
```

When run in a TTY, generation also shows a spinner while files are being built.

## Machine Profiles

A machine profile is a JSON file that describes machine-specific generation
policy. It is separate from the VMID: the VMID describes SolidCAM machine data,
while the machine profile describes how Achar should emit controller code for a
real target machine.

The same trace and VMID can be generated for multiple machine profiles:

```bash
bun run achar generate trace.MPF \
  --vmid machine.vmid \
  --machine-profile machines/1160L.machine.json \
  --out generated/1160L

bun run achar generate trace.MPF \
  --vmid machine.vmid \
  --machine-profile machines/other-machine.machine.json \
  --out generated/other-machine
```

Machine profiles are optional. If a post behavior depends on a profile value
that has no safe default, the post should throw a clear error explaining that a
machine profile is required.

Initial schema:

```json
{
  "id": "poyakar-1160l-3a",
  "name": "PoyaKar 1160L 3A",
  "controller": "siemens-828d",
  "axes": 3,
  "features": {
    "toolMeasurementProgram": true,
    "toolMeasurementProgramDeferred": true,
    "mainToolListComments": true,
    "dwellAfterCoolantOn": true,
    "dwellAfterCoolantOff": true,
    "cancelAirCoolantSchedule": false,
    "forceInitialApproachPosition": true,
    "inlineFeedRateMode": false,
    "compactCoordinates": true
  },
  "home": {
    "x": -465,
    "y": 190,
    "z": 0
  },
  "returnHome": {
    "x": 260,
    "y": 190,
    "z": 0
  }
}
```

Supported fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Stable machine profile id. |
| `name` | No | Human-readable name. |
| `controller` | No | Controller family, such as `siemens-828d`. |
| `axes` | No | Number of machine axes expected by this profile. |
| `features.toolMeasurementProgram` | No | Whether to emit `Tools_Length_Measurement.MPF`. Defaults to true in the unified Siemens post. |
| `features.toolMeasurementProgramDeferred` | No | Whether to generate the tool measurement program after the main program so it does not consume early main-program N-numbers. |
| `features.mainToolListComments` | No | Whether to emit a main-file `Tools Used In This Program` comment block even when tool measurement output is enabled. |
| `features.dwellAfterCoolantOn` | No | Whether to emit `G04F2` after `M8`. |
| `features.dwellAfterCoolantOff` | No | Whether to emit `G04F2` after final `M9`. |
| `features.cancelAirCoolantSchedule` | No | Whether to emit scheduled-air-coolant `CANCEL(...)` cleanup. Defaults to true for existing Siemens parity. |
| `features.forceInitialApproachPosition` | No | Whether to repeat the first approach XY position after the first job-start Z move. |
| `features.inlineFeedRateMode` | No | Whether first feed moves emit an inline `G94`. Defaults to true for existing Siemens parity. |
| `features.compactCoordinates` | No | Whether to compact trace coordinates through the post formatter before emitting them. |
| `home` | No | Machine home values used by the post. |
| `returnHome` | No | End-of-program return-home values used by the post. |

Achar validates profile compatibility where it has enough data. For example, if
the profile declares `axes: 3` but the VMID defines four axes, generation fails
with a machine-profile compatibility error.

## Watch Mode

The workflow commands `generate`, `parity`, and `test` support watch mode.

Generate on every input change:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out generated/full --watch
```

Run parity on every input change:

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --watch
```

Run tests on every input change:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --watch
```

Watch mode tracks:

- The target trace file or fixture manifest.
- Fixture trace, reference, VMID, and custom post entry files.
- Explicit `--reference`, `--vmid`, and custom `--post` paths.
- Files directly inside watched directories with extensions:
  `MPF`, `SPF`, `json`, `vmid`, `ts`, and `js`.

Watch mode is intentionally simple. If a custom post imports helper files that
are not watched directly, rerun manually or touch the watched post entry file.

## Command Reference

### `parse`

Parse a SolidCAM trace into Achar IR JSON:

```bash
bun run achar parse fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF --out generated/Setup1.ir.json
```

Options:

```text
--out <file>  Output JSON file.
```

Use this when learning what a trace contains before writing or debugging a
post. The output is structured event data, not G-code.

### `vmid`

Inspect a VMID file:

```bash
bun run achar vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Print parsed data as JSON:

```bash
bun run achar vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid --json
```

Options:

```text
--json  Print parsed VMID data as JSON.
```

Use this to confirm machine name, axes, post processor names, and user-defined
parameters parsed from `Param` and `ParamJobs`.

### `vmid-types`

Generate TypeScript trace extensions from a VMID:

```bash
bun run achar vmid-types fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid \
  --out generated/vmid.generated.ts
```

Print to stdout:

```bash
bun run achar vmid-types fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Options:

```text
--out <file>             Output TypeScript file; prints to stdout when omitted.
--interface-name <name>  Base interface name.
```

Use this when a post needs typed access to controller-specific VMID user
parameters.

### `posts`

List built-in post modules:

```bash
bun run achar posts
```

This helps confirm the exact id to use with `--post`.

### `init-post`

Create a new post scaffold:

```bash
bun run achar init-post posts/my-controller \
  --name "My Controller" \
  --fixture \
  --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --reference fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference \
  --program-name Setup1 \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Options:

```text
--name <name>            Human-readable post name.
--force                  Overwrite scaffold files if they already exist.
--fixture                Create achar.fixture.json with supplied paths.
--trace <file>           Fixture trace path.
--reference <directory>  Fixture reference G-code directory.
--program-name <name>    Fixture program name.
--vmid <file>            Fixture VMID path.
```

The scaffold includes:

```text
index.ts
post.config.ts
driver.ts
policy.ts
README.md
achar.fixture.json  only when --fixture is passed
```

Without `--force`, Achar refuses to overwrite existing scaffold files.

### `validate`

Validate trace inputs against VMID metadata:

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Validate a raw trace:

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Fail on warnings as well as errors:

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --strict-vmid
```

Options:

```text
--vmid <file>  VMID file. Fixtures can provide this.
--strict-vmid  Treat VMID warnings as failures.
```

Validation checks:

- The trace `VMID_file` matches the VMID machine name.
- Axis fields used by the trace exist in the VMID.
- GPP-style user parameters in the trace are declared in the VMID.

If no VMID is supplied, Achar prints that VMID validation was skipped.

### `generate`

Generate MPF/SPF files:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Write to a specific directory:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out generated/full
```

Run a custom post:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --post ./posts/my-controller/index.ts
```

Use a raw trace:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --out generated/full \
  --program-name Setup1 \
  --post siemens-828d \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Options:

```text
--out <directory>      Output directory.
--program-name <name>  Program name for the main MPF.
--post <name-or-file>  Post module. Built-ins: default, siemens-828d.
--vmid <file>          VMID file. Fixtures can provide this.
--machine-profile <file>  Machine profile JSON file.
--strict-vmid          Treat VMID warnings as failures.
--watch                Watch inputs and regenerate on changes.
--interactive          Prompt for generate options.
```

Exit status is `0` when generation succeeds and VMID validation does not fail.
It is non-zero when required inputs are missing, VMID errors are found, or
`--strict-vmid` promotes warnings to failures.

### `parity`

Generate files, compare them against reference G-code, and print differences:

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Compare a raw trace:

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --reference fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference \
  --out generated/full \
  --program-name Setup1 \
  --post siemens-828d \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Write an HTML report:

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/full-report.html
```

Options:

```text
--reference <directory>    Reference G-code directory.
--out <directory>          Generated output directory.
--program-name <name>      Program name for the main MPF.
--post <name-or-file>      Post module. Built-ins: default, siemens-828d.
--all-reference-files      Compare every MPF/SPF in the reference directory.
--strict                   Disable normalization and fail on any mismatch.
--no-normalize-timestamps  Do not normalize legacy post timestamps.
--max-diffs <count>        Maximum line diffs to print per file. Default: 5.
--report <file>            Write an HTML diff report.
--vmid <file>              VMID file. Fixtures can provide this.
--machine-profile <file>   Machine profile JSON file.
--strict-vmid              Treat VMID warnings as failures.
--watch                    Watch inputs and rerun parity on changes.
```

By default, parity prints differences but only fails on VMID errors. Add
`--strict` when any generated/reference mismatch should fail the command, such
as in CI.

### `test`

Run a golden-output post regression test:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Run all fixtures under a root directory:

```bash
bun run achar test fixtures --all
```

Write a report:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/report.html
```

Update reference output after reviewing an intentional change:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --update
```

Options:

```text
--reference <directory>    Reference G-code directory.
--out <directory>          Generated output directory.
--program-name <name>      Program name for the main MPF.
--post <name-or-file>      Post module. Built-ins: default, siemens-828d.
--all                      Discover and run every fixture under the target directory.
--all-reference-files      Compare every MPF/SPF in the reference directory.
--strict                   Disable normalization.
--no-normalize-timestamps  Do not normalize legacy post timestamps.
--max-diffs <count>        Maximum line diffs to print per file. Default: 5.
--update                   Update reference G-code with generated output.
--report <file>            Write an HTML diff report.
--vmid <file>              VMID file. Fixtures can provide this.
--machine-profile <file>   Machine profile JSON file.
--strict-vmid              Treat VMID warnings as failures.
--watch                    Watch inputs and rerun tests on changes.
```

`test` fails on:

- Any different file.
- A generated file with no matching reference.
- A reference file missing from generated output.
- VMID validation errors.
- VMID warnings when `--strict-vmid` is used.

Use `test` for CI. Use `parity` for exploratory comparison unless you pass
`--strict`.

### `explain`

Explain which trace event emitted each generated command:

```bash
bun run achar explain fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Filter by generated file:

```bash
bun run achar explain fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --file F_contour8.SPF
```

Filter by trace event:

```bash
bun run achar explain fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --event Line
```

Options:

```text
--post <name-or-file>  Post module.
--program-name <name>  Program name.
--file <name>          Filter by generated MPF/SPF file.
--event <name>         Filter by trace event name.
```

Use this when a generated line is wrong and you need to identify which handler
or trace event produced it.

### `lint-post`

Check a post module for maintainability issues:

```bash
bun run achar lint-post src/posts/siemens-828d/index.ts
```

Also report trace events without handlers:

```bash
bun run achar lint-post src/posts/siemens-828d/index.ts \
  --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF
```

Check a controller driver:

```bash
bun run achar lint-post src/posts/siemens-828d/driver.ts --driver
```

Options:

```text
--driver        Treat the source as a controller driver.
--trace <file>  Also report trace events without handlers.
```

Use this to catch raw output patterns, duplicate handlers, missing handlers, and
other post-authoring risks.

## Comparison Modes

Normal comparison is tolerant of expected legacy timestamp differences.

Use strict byte-level comparison:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --strict
```

Disable only timestamp normalization:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --no-normalize-timestamps
```

Compare every reference file:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --all-reference-files
```

Increase or reduce printed line differences:

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --max-diffs 20
```

## Reports

Both `parity` and `test` can write an HTML report:

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/parity-report.html
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/test-report.html
```

Reports are useful when reviewing many differences because they keep generated
and reference mismatches in one inspectable artifact.

## CI Workflow

A typical CI job should install dependencies and run tests:

```bash
bun install --frozen-lockfile
bun test
bun run achar test fixtures --all --strict-vmid --report generated/achar-report.html
```

Use `--strict` if any formatting or timestamp difference should fail:

```bash
bun run achar test fixtures --all --strict --strict-vmid
```

Avoid `--update` in CI. Updating reference output should be a deliberate local
action after reviewing generated changes.

## Common Workflows

### Learn a Trace Before Writing a Post

```bash
bun run achar parse trace.MPF --out generated/trace.ir.json
bun run achar vmid machine.vmid
bun run achar validate trace.MPF --vmid machine.vmid
```

### Create a New Post

```bash
bun run achar init-post posts/acme-mill \
  --name "Acme Mill" \
  --fixture \
  --trace fixture/trace.MPF \
  --reference fixture/reference \
  --program-name ACME_PART \
  --vmid fixture/machine.vmid

bun run achar generate posts/acme-mill --out generated/acme
bun run achar test posts/acme-mill
```

### Debug a Wrong Output Line

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/debug-report.html
bun run achar explain fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --file F_contour8.SPF
bun run achar lint-post src/posts/siemens-828d/index.ts --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF
```

### Refresh Golden Output Intentionally

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out /tmp/review-output
# Review the generated files.
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --update
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Commit post changes and reference output changes together.

## Exit Codes

Commands return `0` for success.

Expected non-zero cases:

- Required argument or option is missing.
- Input file or post module cannot be loaded.
- VMID validation has errors.
- Machine profile compatibility validation has errors.
- VMID validation has warnings and `--strict-vmid` is used.
- `test` finds output mismatches.
- `parity --strict` finds output mismatches.
- Scaffold creation would overwrite files and `--force` was not passed.

## Troubleshooting

### Missing `--out`

Raw trace generation needs an output directory:

```text
Missing required option: --out
```

Pass `--out`, use an interactive run, or create a fixture with an `out` field.

### Missing `--reference`

`test` and `parity` need a reference directory when the target is a raw trace:

```bash
bun run achar test trace.MPF \
  --reference reference \
  --program-name Setup1 \
  --post siemens-828d
```

Fixtures usually avoid this because `reference` is stored in
`achar.fixture.json`.

### No VMID Supplied

This message is informational:

```text
No VMID supplied; skipping VMID validation
```

Pass `--vmid` or add `vmid` to the fixture when VMID checks matter.

### VMID Warnings Do Not Fail

Warnings do not fail by default. Use:

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --strict-vmid
```

The same flag is available on `generate`, `parity`, and `test`.

### Post Module Cannot Load

Check whether `--post` is one of:

- A built-in id such as `siemens-828d`.
- An alias such as `default`.
- A valid relative or absolute path to a TypeScript or JavaScript module.

Run:

```bash
bun run achar posts
```

Then retry:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --post siemens-828d
```

### Generated File Is Missing From Reference

This usually means the TypeScript post creates an extra file or uses a different
file name than the legacy GPP output. Use:

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --all-reference-files
bun run achar explain fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

### Reference File Is Missing From Generated Output

This usually means the post skipped an operation, did not open a subprogram, or
used a different file name. Use:

```bash
bun run achar explain fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --event StartProgram
bun run achar lint-post src/posts/siemens-828d/index.ts --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF
```

### Lockfile or Bun Path Problems

Use the native Bun binary inside WSL when working in this repository from WSL:

```bash
/home/catinrage/.bun/bin/bun install --frozen-lockfile
/home/catinrage/.bun/bin/bun run achar --help
```

Using a Windows Bun shim from `/mnt/c/...` against a WSL workspace can cause
lockfile replacement or bin metadata issues.

## Recommended Defaults

For local post development:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out generated/full --watch
```

For regression checks:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

For CI:

```bash
bun run achar test fixtures --all --strict-vmid
```

For release-quality comparison:

```bash
bun run achar test fixtures --all --strict --strict-vmid --report generated/report.html
```
