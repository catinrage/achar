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
bun run achar --help
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
  setups <trace-or-fixture>     List the setups in a trace.
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
| `ignored` | No | When `true`, the fixture is skipped by fixture discovery — `achar test --all` and the parity test suite exclude it. Defaults to `false`. Targeting the fixture directory directly still runs it (with a notice). |

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

A profile answers two separate questions, and keeps them apart:

- **What is this machine?** — the `features` block, plus `axes`, `home`, and
  `returnHome`. Everything a machinist could point at on the shop floor.
- **Which output convention must its G-code follow?** — the `dialect` field,
  a single name. Dialects are defined in the post's code, not in profiles,
  because they describe how the text is written rather than what the machine
  is. Two machines wired identically produce different files when different
  legacy GPPs posted them; one machine produces the same file whichever job
  it runs.

Run `achar posts` to see which dialects a post can speak. An unknown dialect
is an error, never a silent fallback to the default.

A profile can also start from another with `extends`, stating only what
differs. In a file, the reference is a path relative to the profile that
writes it:

```json
{
  "id": "poyakar-1160l-4a",
  "extends": "../machines/poyakar-1160l-3a.machine.json",
  "axes": 4
}
```

Merging is per-section and one level deep: a `features` key the derived
profile does not mention keeps the base's value, and `home.z` survives a
derived profile that only moves `home.x`. `id` is never inherited — two
machines sharing one is the confusion profiles exist to prevent. A missing
base, a cycle, or a chain deeper than eight levels is an error.

Schema:

```json
{
  "id": "poyakar-1160l-3a",
  "name": "PoyaKar 1160L 3A",
  "controller": "siemens-828d",
  "axes": 3,
  "dialect": "poyakar-1160l",
  "features": {
    "toolMeasurementProgram": true,
    "dwellAfterCoolantOn": true,
    "dwellAfterCoolantOff": true,
    "tapCycleOptionalStop": true
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
| `dialect` | No | Output convention the post must follow. Omit for the post's stock dialect. |
| `extends` | No | Another profile to start from. A path relative to this file; a machine id in the workshop. |
| `features.toolMeasurementProgram` | boolean | The machine has a tool-length probe, so `Tools_Length_Measurement.MPF` is worth emitting. Defaults to true. |
| `features.dwellAfterCoolantOn` | boolean | Coolant needs a `G04F2` dwell after `M8` before cutting. |
| `features.dwellAfterCoolantOff` | boolean | Coolant needs a `G04F2` dwell after the final `M9`. |
| `features.tapCycleOptionalStop` | boolean | Tapping cycles get an `M1` operator stop before every call. |
| `features.maxSpindleSpeed` | number, rpm | Fastest the spindle can turn. A program commanding more is refused. |
| `features.toolChanger` | `carousel`, `umbrella`, `manual` | How tools are exchanged. Recorded only; no post branches on it yet. |
| `home` | No | Machine home values used by the post. |
| `returnHome` | No | End-of-program return-home values used by the post. |

### Siemens 828D dialects

| Dialect | Matches |
| --- | --- |
| `siemens-828d` | Stock `Siemens_828D_Milling_4A.gpp` output. The default. |
| `poyakar-1160l` | `PoyaKar_1160L_3A.gpp` output. |

The traits a dialect fixes — modal `F` suppression, inline `G94`, coordinate
compaction, the tool-list comment block, air-coolant `CANCEL` cleanup, the
drill approach-Z repeat, cross-job coolant retention, tool-measurement file
ordering, and whether a job's start block needs a tool change — are listed in
`packages/core/src/posts/siemens-828d/dialect.ts`, each with the fixture and
GPP source that pins it. Adding a dialect is a reviewed code change; adding a
machine is not.

Dialect traits are rejected if left in `features`. A profile carrying the old
flat flag set fails to load with a message naming the moved keys, rather than
loading with them silently ignored and posting subtly different G-code.

Every value a post reads is resolved once, at load, against a single table of
defaults per post — `SIEMENS_828D_MACHINE_DEFAULTS` for the Siemens 828D. A
machine that says nothing gets exactly the behaviour it had before profiles
existed, and a machine that says `false` gets false rather than the default,
which a per-read `?? true` could not express.

### Machine properties

The `features` vocabulary is declared as a table in
`packages/core/src/lib/machine-features.ts`. One row per property carries its
key, type, bounds, label and description; that single row types the field,
validates a loaded profile, and describes it to the workshop's machine form.
Adding a property is adding a row.

Properties are typed, not just boolean: `maxSpindleSpeed` is a whole number of
at least 1, `toolChanger` is one of a fixed set. Values are checked against
those bounds at load.

An unrecognised key under `features` is an error rather than something to
ignore. A key nobody reads is a setting its author believes is in force and is
not, which on this system means G-code that differs from what the profile
describes.

Declaring `maxSpindleSpeed` makes it enforced: any program whose commanded
speed exceeds it fails validation, naming the highest speed found. On the
`generate` path that refuses the run; in the workshop the job is recorded as
blocked with the reason attached.

### What confirms a profile

A profile is a set of claims about a machine. The trace, the VMID and the post
each know some of the same facts from a different direction, and a
disagreement means one of them is describing a different machine. Everything
achar can cross-check, it does:

| Claim | Confirmed against | On mismatch |
| --- | --- | --- |
| `axes` | trace `iNumberOfAixs`, VMID axis count | error |
| `controller` | the bound post's controller family | error |
| `dialect` | the bound post's dialect list | error |
| `features.maxSpindleSpeed` | highest `spin` in the trace | error |
| `home`, `returnHome` | VMID axis travel limits | error |

All of them block generation rather than warn. A profile that disagrees with
the VMID is not a style problem — it produces a plausible file for the wrong
machine, which is the one outcome this tool exists to prevent.

The post checks apply only to built-in posts, which declare a controller and a
dialect list. A custom post module supplies neither and is left unchecked; it
can target whatever it likes.

`home` and `returnHome` are worth singling out: the post emits them
unconditionally at the start and end of every program, so one outside the
machine's travel is a crash on the first and last move of every job it runs.
Both the profile and the VMID already state the numbers, so nothing is
inferred.

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
--setups <selection>   Post only these setups. See "Posting a subset of setups".
--keep-all-tools       With --setups, keep the full tool table.
--watch                Watch inputs and regenerate on changes.
--interactive          Prompt for generate options.
```

Exit status is `0` when generation succeeds and VMID validation does not fail.
It is non-zero when required inputs are missing, VMID errors are found, or
`--strict-vmid` promotes warnings to failures.

### `setups`

List the setups in a trace, with the index `generate --setups` expects:

```bash
bun run achar setups fixtures/PROJECT_2541021_CAM_Milling
```

```text
#  Setup   Fixture  Home  Jobs  Duration
-  ------  -------  ----  ----  --------
1  Setup1  Fixture  1     13    0:13:14
2  Setup2  Fixture  1     4     0:03:01
3  Setup3  Fixture  3     43    0:21:34
```

Options:

```text
--json  Print the list as JSON on stdout.
```

Setup names come from SolidCAM and are not guaranteed unique, so the index is
the reliable address. A trace whose jobs start before its first `@setup` gets a
note: those jobs belong to the shared prologue and are posted with every
selection.

`--json` prints the same objects the workshop UI lists in its setup picker —
`index`, `name`, `fixtureName`, `partHomeNumber`, `jobCount`, `seconds`,
`duration` — because both come from one function in core. Two implementations
of that alignment would be two chances for the indices to mean different
setups, and the index is what a person types back.

## Posting a Subset of Setups

A setup is one physical fixturing of the part, and the operator runs one at a
time. `--setups` posts only the ones named:

```bash
# Indices, ranges, and names all work, in any order
bun run achar generate fixtures/PROJECT_2541021_CAM_Milling --setups 2      --out generated/setup2
bun run achar generate fixtures/PROJECT_2541021_CAM_Milling --setups 1-2    --out generated/front
bun run achar generate fixtures/PROJECT_2541021_CAM_Milling --setups Setup1,Setup3 --out generated/odd
```

A trace is strictly linear — a shared prologue, one contiguous span per
`@setup`, then a shared epilogue — so the selection keeps the prologue, the
chosen spans in trace order, and the epilogue, then regenerates from there.
Selection order does not matter: setups are always posted in the order the part
was programmed.

Without `--setups`, nothing changes. The flag is additive and the default path
is byte-identical to before.

`--setups` is also available on `explain`, which is the fastest way to see how
one setup posts. It is deliberately **not** available on `parity` or `test`:
those compare against a reference for the whole program, so a subset has
nothing to match.

The [workshop UI](workshop-ui.md) offers the same choice as checkboxes, keyed
on the same indices. It takes indices only — names and ranges are a
convenience for a person typing at a shell, and the browser sends back the
numbers the analysis showed it.

### Tool pruning

By default, `DefTool` events for tools no selected setup loads are dropped, so
the tool-list comment and `Tools_Length_Measurement.MPF` describe the run the
operator is about to make rather than the whole part. Tool numbers are carried
on each event and are never renumbered, so the remaining tools keep their
identity. Pass `--keep-all-tools` to keep the full table.

### What a subset is not

A subset run is a new, self-consistent program — not a byte-slice of the full
one. Two consequences:

**Block numbers restart.** The Builder shares one N-number counter across every
generated file, so the main MPF's numbers advance in step with the subprogram
bodies. A subset starts from `N10`, and its numbers will not line up with the
corresponding lines of a full run. Diff with `--ignore-numbering` if you need to
compare.

**A setup posted without its predecessor starts from program defaults.** The
post is a modal state machine: it emits only what changed. A setup that is not
first in the program inherits real values from the setup before it — most
consequentially the cutting tolerance, which carries forward whenever a job does
not state its own `Cut_tolerance`, plus the modal G-groups and last position
that decide whether a move is written out in full. Post setup 2 alone and its
first job can differ from the same job in a full run:

```text
-_camtolerance=0.003     (full run: inherited from setup 1's last profile job)
+_camtolerance=0.1       (subset:   the fresh-program default)
```

The CLI warns whenever a selected setup has lost the setup before it, and names
what to check. An unbroken run starting at setup 1 has nothing to inherit and is
identical to the full run apart from block numbers — verified on
`PROJECT_2541021_CAM_Milling`, where `--setups 1-2` reproduces all 17 of the
corresponding subprograms exactly.

Output filenames do not change, so a partial program will overwrite a full one
in the same `--out` directory. Give each selection its own directory.

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

### `timing`

Extract machining durations from a trace: per setup (with its jobs and their
tools) and per tool, aggregated from the `job_time` / `job_cutting_time` /
`job_linking_time` stamps SolidCAM writes on every job start.

A transform (translate, rotary pattern, mirror) re-emits the same job once per
position, and SolidCAM stamps every repeat with the time for the *whole*
pattern rather than for one position. Since SolidCAM operation names are
unique, a repeated `job_name` is always such a pattern: its time is counted
once while `instances` records how many times it ran, so per-tool totals line
up with SolidCAM's declared `tool_work_time` (included as `declaredWorkTime`
for comparison). If two starts of one job name ever disagree on their stamped
times, the command fails rather than guess which one is the real total.

```bash
# Writes <fixture out>/timing.json
bun run achar timing fixtures/PROJECT_26646_CAM_Milling

# Explicit destination or stdout
bun run achar timing fixtures/PROJECT_26646_CAM_Milling --out reports/timing.json
bun run achar timing fixtures/PROJECT_26646_CAM_Milling --json
```

Options:

```text
--out <file-or-directory>  JSON destination. Defaults to <fixture out>/timing.json.
--json                     Print the report to stdout instead of writing a file.
```

Durations are `H:MM:SS` strings with raw `seconds` fields alongside for
machine consumption.

### `lint-post`

Check a post module for maintainability issues:

```bash
bun run achar lint-post packages/core/src/posts/siemens-828d/index.ts
```

Also report trace events without handlers:

```bash
bun run achar lint-post packages/core/src/posts/siemens-828d/index.ts \
  --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF
```

Check a controller driver:

```bash
bun run achar lint-post packages/core/src/posts/siemens-828d/driver.ts --driver
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
bun run achar lint-post packages/core/src/posts/siemens-828d/index.ts --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF
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
bun run achar lint-post packages/core/src/posts/siemens-828d/index.ts --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF
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
