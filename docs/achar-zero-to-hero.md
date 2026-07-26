# Achar From Zero To Hero

This document is the complete working guide for Achar as it exists in this
repository. It is written for someone who already understands the basics of CNC
post-processors and has basic familiarity with SolidCAM GPP: events, variables,
VMID files, post output, subprograms, and the usual job of turning CAM output
into controller-specific G-code.

Achar is not a generic CAM system. It is a TypeScript framework and CLI for
writing SolidCAM trace-driven post-processors without writing GPP language. The
current production reference post is the bundled Siemens 828D Milling 4A post,
but Achar itself is not tied to Siemens. Siemens support lives under
`packages/core/src/posts/siemens-828d`; the core parser, program, builder, fixture runner,
VMID parser, and test harness are reusable for other controllers.

## Table Of Contents

1. What Achar Replaces
2. Mental Model For GPP Developers
3. Repository Layout
4. Installation And First Run
5. The CLI
6. Trace Files And Parsing
7. Events And Handlers
8. The Builder API
9. Files, Main Programs, And Subprograms
10. Machine State And Modal Output
11. Writing Your First Post
12. Migrating A GPP Post Incrementally
13. Fixtures
14. VMID Input And Validation
15. Regression Tests And Golden Output
16. Diff Reports And Snapshot Updates
17. Watch Mode
18. Built-In Posts And Custom Posts
19. Packaging And Public API
20. Production Parity Workflow
21. Troubleshooting
22. Current Limits And Future Work
23. Reference Cheat Sheets

## 1. What Achar Replaces

SolidCAM GPP posts are usually written as event handlers, global variables,
string output logic, and helper procedures. Achar keeps the event-driven shape
but replaces the language and runtime:

- GPP event handlers become `program.on('EventName', handler)`.
- GPP variables become typed `params` objects or normal TypeScript state.
- GPP `@` event blocks from trace mode 5 become parsed `EventData`.
- GPP output commands become `Builder` calls like `$.put`, `$.Rapid`, `$.Line`,
  `$.OpenFile`, `$.ExtCall`, and `$.Comment`.
- VMID-defined user parameters can be validated before generating output.
- Golden G-code comparison becomes a normal CLI command and test helper.

Achar does not try to imitate GPP syntax. It provides a TypeScript framework
with the same post-processing job:

```text
SolidCAM trace mode 5 + optional VMID + post module
  -> parsed event stream
  -> TypeScript event handlers
  -> generated MPF/SPF files
  -> regression comparison against known-good GPP output
```

## 2. Mental Model For GPP Developers

If you already know GPP, use these mappings:

| GPP idea | Achar equivalent |
| --- | --- |
| Post file | TypeScript post module exporting `registerPost(program)` |
| GPP event/procedure | `program.on('StartOfFile', ($, params, metadata) => {})` |
| GPP variable from trace | `params.some_field` |
| GPP user-defined VMID variable | `params.bSomeFlag`, `params.C81_DTB`, etc. plus VMID validation |
| `trace5` debug output | Achar parser input |
| Write a normal block | `$.Block([{ letter: 'G', value: 0 }, { letter: 'X', value: 0 }])` |
| Controller-specific function | `$.driver(siemens828dDriver).Cycle832(...)` |
| Modal suppression | `Machine` emitters inside `Builder` |
| Main program and subprograms | `$.OpenFile`, `$.CloseFile`, `$.Call`, `$.ExtCall` |
| Manual verification | `achar test` and Vitest golden tests |
| Updating expected output | `achar test --update` |

The handler signature is always:

```typescript
program.on('EventName', (builder, params, metadata) => {
  // builder writes G-code.
  // params contains event fields.
  // metadata lets you inspect neighboring events.
});
```

In examples, the builder is normally named `$`:

```typescript
program.on('ToolChange', ($, params) => {
  $.SelectTool(params.tool_id_string);
  $.ChangeTool();
});
```

## 3. Repository Layout

Important paths:

```text
packages/cli/src/index.ts                    CLI entrypoint
packages/core/src/index.ts                  Public package API
packages/core/src/application/achar-service.ts
                                           Shared CLI/MCP/desktop application service
packages/core/src/lib/parser.ts             SolidCAM trace parser
packages/core/src/lib/program.ts            Event orchestration
packages/core/src/lib/event.ts              Event and metadata types
packages/core/src/lib/builder.ts            G-code/file builder
packages/core/src/lib/machine.ts            Modal machine state
packages/core/src/lib/file.ts               Per-file line buffering
packages/core/src/lib/post-test.ts          Golden-output comparison engine
packages/core/src/lib/fixture.ts            Fixture manifest loading/discovery
packages/core/src/lib/vmid.ts               VMID parser and validation
packages/core/src/lib/post-loader.ts        Built-in/custom post loading
packages/core/src/lib/builtin-posts.ts      Built-in post registry
packages/core/src/lib/default-post.ts       Compatibility re-export
packages/core/src/posts/siemens-828d        Bundled Siemens 828D post
packages/core/src/types.ts                  Trace event and command types
packages/mcp/src/server.ts                  MCP stdio server
packages/desktop/src                       Electrobun/Svelte desktop app
fixtures/PROJECT_434_112466504665666_CAM_2_MILLING                     First real Siemens fixture
fixtures/PROJECT_2551019_CAM_MILLING
                              Second, larger real Siemens fixture
docs/post-authoring.md        Short post author guide
docs/achar-zero-to-hero.md    This manual
test/README.md                Test workflow notes
```

The core is `packages/core/src/lib/*`. Controller-specific post logic should
live under `packages/core/src/posts/*` for bundled posts or in an external post
module. The bundled Siemens post stays in core for now so it can be split out
later without changing the root `achar/posts/siemens-828d` export.

## 4. Installation And First Run

Install dependencies:

```bash
bun install
```

Run the checks:

```bash
./node_modules/.bin/biome check .
./node_modules/.bin/tsc --noEmit
bun test
```

Run the real full fixture:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Expected result for the current repository:

```text
VMID validation passed
Parity: 25 matched, 0 different, 0 missing generated, 0 missing reference
```

Run every real fixture:

```bash
bun run achar test fixtures --all
```

The second fixture currently matches all 92 reference files.

The normal comparison intentionally normalizes volatile legacy output such as
post timestamps and trailing formatting differences. Strict byte-level mode can
still fail on timestamp/trailing-space differences even when machining content
matches.

## 5. The CLI

Achar is a CLI tool. The local development form is:

```bash
bun run achar <command>
```

The package also declares:

```json
{
  "bin": {
    "achar": "packages/cli/src/index.ts"
  }
}
```

After linking/installing, the intended installed form is:

```bash
achar <command>
```

### CLI Commands

Show help:

```bash
bun run achar --help
```

Current commands:

```text
parse <trace>                 Parse a SolidCAM trace into Achar IR JSON.
vmid <vmid>                   Inspect a SolidCAM VMID file.
posts                         List built-in post modules.
init-post <directory>         Create a new Achar post module skeleton.
validate <trace-or-fixture>   Validate trace inputs, including VMID user parameters and axes.
vmid-types <vmid>             Generate TypeScript trace extension interfaces.
lint-post <file>              Check post architecture and optional trace event coverage.
explain <trace-or-fixture>    Show which event emitted each command.
generate <trace-or-fixture>   Generate MPF/SPF files from a trace or fixture.
parity <trace-or-fixture>     Generate files and compare them against reference G-code.
test <trace-fixture-or-root>  Run golden-output post regression tests. Fails on any mismatch.
```

### `parse`

Parse trace mode 5 into JSON:

```bash
bun run achar parse fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF --out generated/Setup1.ir.json
```

Use this when learning what SolidCAM gives you before writing post logic.

### `vmid`

Inspect a VMID:

```bash
bun run achar vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Print JSON:

```bash
bun run achar vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid --json
```

### `posts`

List bundled posts:

```bash
bun run achar posts
```

Current output:

```text
siemens-828d  Siemens 828D Milling 4A aliases: default
```

### `init-post`

Create a custom post skeleton:

```bash
bun run achar init-post posts/my-controller \
  --fixture \
  --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --reference fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Generated files:

```text
index.ts
README.md
achar.fixture.json   only when --fixture is passed
```

Useful options:

```text
--name <name>            Human-readable post name.
--force                  Overwrite scaffold files if they already exist.
--fixture                Create achar.fixture.json with supplied paths.
--trace <file>           Fixture trace path.
--reference <directory>  Fixture reference G-code directory.
--program-name <name>    Fixture program name.
--vmid <file>            Fixture VMID path.
```

### `validate`

Validate a trace or fixture:

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Validate with warnings treated as failures:

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --strict-vmid
```

Validate a raw trace with explicit VMID:

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid \
  --strict-vmid
```

### `generate`

Generate output:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Prompt for inputs interactively:

```bash
bun run achar generate
```

Override output directory:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out generated/full
```

Run from a raw trace without a fixture:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --out generated/full \
  --program-name Setup1 \
  --post siemens-828d \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Run a custom post module:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --post ./posts/my-controller/index.ts
```

Watch and regenerate:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out generated/full --watch
```

`generate` prints how many files were written and how long the run took.

### `parity`

Generate and compare:

```bash
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/full-report.html
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

Useful options:

```text
--all-reference-files      Compare every MPF/SPF in the reference directory.
--strict                   Disable normalization and fail on any mismatch.
--no-normalize-timestamps  Do not normalize legacy post timestamps.
--max-diffs <count>        Maximum line diffs to print per file.
--report <file>            Write an HTML diff report.
```

### `test`

Run golden-output regression test:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Run all fixtures:

```bash
bun run achar test fixtures --all
```

Update golden output intentionally:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --update
```

Write a report:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/report.html
```

Watch and rerun tests:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --watch
```

## 6. Trace Files And Parsing

Achar expects SolidCAM trace mode 5 style output. A trace block looks like:

```text
(1)@start_of_file   ==> build_revision:152076 program_number:1000 g_file_name:'SETUP1.MPF'
                    ..> VMID_file:'Siemens_828D_Milling_4A'
                    ..> inch_system:0 user_account:'ABDOLLAH'
```

The parser:

- Detects event headers like `(1)@start_of_file`.
- Converts snake-case event names to PascalCase (`start_of_file` -> `StartOfFile`).
- Extracts key/value pairs from event body lines.
- Converts strings, numbers, booleans, and known enum-like values.
- Preserves SolidCAM `T`/`F` change markers as `field__changed` metadata.
- Uses an emitted drill-cycle line as an optional precision hint when trace
  event fields have already been rounded. Typed event values remain the
  fallback when no emitted cycle is present.
- Adds `_eventName` and `_index`.

Programmatic parsing:

```typescript
import { Parser } from 'achar';

const source = await Bun.file('fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF').text();
const events = new Parser(source).parse();
console.log(events[0]._eventName);
```

CLI parsing:

```bash
bun run achar parse fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF --out generated/ir.json
```

## 7. Events And Handlers

A post registers event handlers:

```typescript
import type { Program } from 'achar';

export function registerPost(program: Program): void {
  program.on('StartOfFile', ($, params, metadata) => {
    $.Comment(`Author: ${params.user_account}`);
  });
}
```

The handler receives:

- `builder`: usually named `$`, writes G-code and manages files.
- `params`: typed payload for the current event.
- `metadata`: navigation helpers for the event stream.

### Event Ordering

Events are processed in the same order they appear in the trace. Multiple
handlers for the same event are executed in registration order.

```typescript
program.on('StartOfFile', ($) => {
  $.Comment('first');
});

program.on('StartOfFile', ($) => {
  $.Comment('second');
});
```

### Removing Handlers

`Program.off(eventName, listener)` removes a previously registered handler:

```typescript
const handler = ($: Builder) => {
  $.Comment('temporary');
};

program.on('StartOfFile', handler);
program.off('StartOfFile', handler);
```

### Metadata Helpers

`metadata` includes:

```typescript
metadata.index
metadata.eventCallCounter
metadata.currentFile()
metadata.next
metadata.previous
metadata.findLastEvent('StartOfJob')
metadata.findNearestEvent('ToolChange')
metadata.findNthNextEvent('Line', 2)
metadata.findNthPreviousEvent('Line', 2)
metadata.findLastEventOrThrow('StartOfJob')
metadata.findNearestEventOrThrow('ToolChange')
metadata.findNthNextEventOrThrow('Line', 2)
metadata.findNthPreviousEventOrThrow('Line', 2)
```

Example: use the current job name while processing a toolpath event:

```typescript
program.on('Line', ($, params, metadata) => {
  const job = metadata.findLastEventOrThrow('StartOfJob').data;
  $.Comment(`Line belongs to ${job.job_name}`);
  $.Line({ x: params.xpos, y: params.ypos, z: params.zpos });
});
```

### Important Event Names

The full event type surface is in `packages/core/src/types.ts`. Important events include:

```text
StartOfFile
VmidInfo
DefTool
AbsoluteMode
MachinePlane
StartProgram
Setup
HomeNumber
Tmatrix
ChangeTool
Compensation
ToolChange
OffsetChange
StartOfJob
JobPlane
ToolPathInfo
Message
MFeedSpin
Line
Move5x
Line5x
Arc
RapidMove
EndOfJob
Drill
DrillPoint
EndDrill
EndProgram
HomeData
EndOfFile
ChangeRefPoint
```

When adding support for a new trace event, first inspect the parsed JSON and
then update `packages/core/src/types.ts` if the event is not yet typed.

## 8. The Builder API

`Builder` is the post author's main output API. In handlers it is normally the
first argument named `$`.

### Typed Blocks And Words

Prefer typed builder helpers over raw output. `$.put(...)` exists, but it should
be the last resort when neither the generic builder nor a controller driver has
the operation you need.

Emit a typed block:

```typescript
$.Block([
  { letter: 'G', value: 0 },
  { letter: 'X', value: 10 },
  { letter: 'Y', value: 20 },
]);
```

Emit one word:

```typescript
$.Word('D', 1);
$.G(54);
$.M(8);
```

Finalize the current buffered line:

```typescript
$.flush();
```

Add comments and blank lines:

```typescript
$.BlankLine();
$.Comment('TOOL LIST');
$.NumberedBlankLine();
```

Generic convenience methods:

```typescript
$.CoolantOn();            // M8
$.CoolantOff();           // M9
$.SpindleStop();          // M5
$.ProgramEndAndRewind();  // M30
```

### Raw Output Escape Hatch

Use raw output only when a helper or driver does not exist yet:

```typescript
$.put('UNKNOWN_CONTROLLER_FEATURE(...)');
```

When you need the same raw output more than once, promote it into a typed driver
method instead of spreading `$.put` calls through the post.

### Motion

Rapid:

```typescript
$.Rapid({ x: 0, y: 0, z: 100 });
```

Linear:

```typescript
$.Line({ x: 10, y: 20, z: -5 });
```

Force coordinates even if the modal machine state thinks they did not change:

```typescript
$.Rapid({ x: 0, y: 0, z: 100 }, { forcePrint: true });
```

Use resolved variants when the post has already decided exactly which axes
should be printed:

```typescript
$.RapidResolved({ x: params.xpos, y: params.ypos });
$.LineResolved({ z: params.zpos });
```

Line with feed-rate mode:

```typescript
$.LineWithFeedRateMode({ x: 10, y: 20 }, 94);
```

Line with custom modal words:

```typescript
$.LineWithModalWords({ x: 10, y: 20 }, ['G642', 'SOFT']);
```

### Machine Modes

```typescript
$.UseMillimeters();      // G710
$.UseInches();           // G700
$.SetAbsoluteMode();     // G90
$.SetIncrementalMode();  // G91
$.SetFeedRateMode(94);   // G94
$.SetFeedRateMode(95);   // G95
```

Machine plane:

```typescript
import { PlaneEnum } from './common/enums';

$.SetMachinePlane(PlaneEnum.XY);
```

### Spindle, Feed, And Tool

```typescript
$.SetFeedRate(1000);
$.SetSpindleSpeed(6000);
$.SetSpindleDirection(params.direction);
$.SelectTool(params.tool_id_string);
$.ChangeTool();
```

### Calls And Stops

```typescript
$.Call('SUB1');
$.ExtCall('SUB1');
$.OptionalStop();
$.ProgramEnd();
$.ProgramEndAndRewind();
```

`ProgramEnd` emits `M2`; `ProgramEndAndRewind` emits `M30`.

## 9. Files, Main Programs, And Subprograms

Achar can output multiple files. The main file is named from the program name:

```typescript
const programName = 'Setup1';
// Main output: Setup1.MPF
```

Open an SPF:

```typescript
$.OpenFile('Face_Mill', 'SPF', 'replace');
$.Comment('FACE MILL SUBPROGRAM');
$.CloseFile();
```

Call it from the main file:

```typescript
$.ExtCall('Face_Mill');
```

Rules:

- New files can only be opened from the main file.
- `CloseFile()` returns to the main file.
- `mode: 'replace'` clears an existing generated file.
- `mode: 'append'` reuses an existing file and continues adding lines.

Example:

```typescript
program.on('StartOfJob', ($, params) => {
  $.OpenFile(params.job_name, 'SPF', 'replace');
  $.Comment(`${params.job_name} - ${params.job_type}`);
});

program.on('EndOfJob', ($, params) => {
  $.CloseFile();
  $.ExtCall(params.job_name);
});
```

## 10. Machine State And Modal Output

`Builder` owns a `Machine`. The `Machine` uses emitters so unchanged modal words
are not printed repeatedly.

Example:

```typescript
$.SetSpindleSpeed(6000); // S6000
$.SetSpindleSpeed(6000); // no duplicate output
$.SetSpindleSpeed(7000); // S7000
```

The same modal suppression applies to:

- X/Y/Z/A/B/C positions.
- G17/G18/G19 machine plane.
- G0/G1 motion mode.
- G700/G710 unit system.
- G90/G91 positioning mode.
- G94/G95 feed-rate mode.
- F feed rate.
- S spindle speed.
- M3/M4 spindle direction.
- T tool selection.

Use `forcePrint` when the controller or post style requires a value even if it
has not changed:

```typescript
$.Line({ x: 10, y: 20 }, { forcePrint: true });
```

Integer rotary axes are formatted with a trailing dot, such as `A4.`. This
matches the current Siemens reference behavior.

## 11. Writing Your First Post

Create a skeleton:

```bash
bun run achar init-post posts/acme-mill \
  --fixture \
  --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --reference fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

Open `posts/acme-mill/index.ts`:

```typescript
import type { Program } from 'achar';

export function registerPost(program: Program): void {
  program.on('StartOfFile', ($, params) => {
    $.BlankLine();
    $.Comment(`Author: ${params.user_account}`);
    $.Comment(`Part: ${params.part_name}`);
    $.UseMillimeters();
    $.SetFeedRateMode(94);
    $.SetAbsoluteMode();
  });

  program.on('StartOfJob', ($, params) => {
    $.OpenFile(params.job_name, 'SPF', 'replace');
    $.Comment(`${params.job_name} - ${params.job_type}`);
  });

  program.on('ToolChange', ($, params) => {
    $.SelectTool(params.tool_id_string);
    $.ChangeTool();
    $.SetSpindleSpeed(params.tool_spin);
    $.SetSpindleDirection(params.tool_direction);
  });

  program.on('Line', ($, params) => {
    $.Line({
      x: params.xpos,
      y: params.ypos,
      z: params.zpos,
    });
  });

  program.on('EndOfJob', ($, params) => {
    $.CloseFile();
    $.ExtCall(params.job_name);
  });

  program.on('EndOfFile', ($) => {
    $.ProgramEndAndRewind();
  });
}

export default registerPost;
```

Run it:

```bash
bun run achar generate posts/acme-mill --out generated/acme
```

Compare it to reference:

```bash
bun run achar test posts/acme-mill
```

At first it will probably differ. That is expected. Use the diff output to add
handlers until it matches the reference for your target controller.

## 12. Migrating A GPP Post Incrementally

Do not translate an entire mature GPP post blindly. Use an incremental process:

1. Put a real trace, VMID, current GPP post, and current GPP output into a
   fixture directory.
2. Create `achar.fixture.json`.
3. Start a TypeScript post with only `StartOfFile`, `EndOfFile`, and file
   structure.
4. Run `achar test`.
5. Implement one event family at a time: tool changes, job start/end, motion,
   cycles, coolant, transforms, measurements.
6. Keep running `achar test` until the diff gets smaller.
7. When output matches, lock it in Vitest or `achar test fixtures --all`.

Useful GPP-to-Achar migration patterns:

### Global GPP State

GPP:

```text
global current_tool
```

Achar:

```typescript
let currentTool: string | undefined;

program.on('ToolChange', (_$, params) => {
  currentTool = params.tool_id_string;
});
```

### GPP Conditional Output

GPP:

```text
if tool_changed then ...
```

Achar:

```typescript
let lastTool: string | undefined;

program.on('ToolChange', ($, params) => {
  if (params.tool_id_string !== lastTool) {
    $.SelectTool(params.tool_id_string);
    $.ChangeTool();
    lastTool = params.tool_id_string;
  }
});
```

### Looking Backward In The Event Stream

Use metadata instead of global state when possible:

```typescript
program.on('Line', ($, params, metadata) => {
  const job = metadata.findLastEventOrThrow('StartOfJob').data;
  if (job.job_type.includes('hss')) {
    $.LineWithModalWords(
      { x: params.xpos, y: params.ypos, z: params.zpos },
      ['SOFT', 'G645'],
    );
  } else {
    $.Line({ x: params.xpos, y: params.ypos, z: params.zpos });
  }
});
```

### Raw Controller-Specific Output

If Achar has no helper for a controller feature, create a driver method. Use
`$.put` only temporarily while discovering the exact syntax:

```typescript
$.put('CYCLE832(0.01,_FINISH,1)');
$.put('TRAORI');
$.put('TRANS X0 Y0 Z0');
```

Then move that syntax into a driver:

```typescript
program.on('StartOfJob', ($) => {
  $.driver(siemens828dDriver).Cycle832({
    tolerance: 0.01,
    mode: '_FINISH',
  });
});
```

Helpers are convenience, not a limit, but production post code should prefer
typed helpers and drivers.

## 13. Fixtures

A fixture is a directory containing `achar.fixture.json`. It can also contain:

- Trace file.
- VMID file.
- Reference G-code directory.
- Current legacy GPP file for human reference.
- Generated output directory outside the fixture.

Example:

```json
{
  "name": "full-siemens-828d-setup1",
  "trace": "Setup1.MPF",
  "reference": "reference",
  "programName": "Setup1",
  "post": "siemens-828d",
  "vmid": "Siemens_828D_Milling_4A.vmid",
  "out": "../../generated/full-siemens-828d-setup1"
}
```

Fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | no | Human-readable fixture name. Defaults to folder name. |
| `trace` | yes | Trace mode 5 file path, relative to fixture root. |
| `reference` | yes | Directory containing expected MPF/SPF files. |
| `programName` | no | Main program name. Defaults from trace filename. |
| `post` | no | Built-in post id or path to post module. |
| `vmid` | no | VMID file path for validation. |
| `out` | no | Generated output directory. |

Load fixtures from TypeScript:

```typescript
import { discoverFixtures, loadFixture } from 'achar';

const fixture = await loadFixture('fixtures/PROJECT_434_112466504665666_CAM_2_MILLING');
const all = await discoverFixtures('data');
```

## 14. VMID Input And Validation

VMID support is in `packages/core/src/lib/vmid.ts`.

Programmatic API:

```typescript
import {
  formatVmidSummary,
  formatVmidValidation,
  parseVmidFile,
  validateTraceAgainstVmid,
} from 'achar';

const vmid = await parseVmidFile('fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid');
console.log(formatVmidSummary(vmid));

const issues = validateTraceAgainstVmid(events, vmid);
console.log(formatVmidValidation(issues));
```

Parsed VMID includes:

- Machine attributes from the root `Machine` element.
- Axis definitions.
- Post processor names.
- User parameters from `Param`.
- Job user parameters from `ParamJobs`.

Validation checks:

- `StartOfFile.VMID_file` matches the VMID machine name.
- Axis fields like X/Y/Z/A/B/C used by trace events exist in the VMID.
- GPP-style user parameters in the trace exist in VMID `Param` or `ParamJobs`.

Issue shape:

```typescript
interface VmidValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  event?: string;
  key?: string;
}
```

Errors fail commands. Warnings fail only with `--strict-vmid`.

## 15. Regression Tests And Golden Output

The golden-output harness is in `packages/core/src/lib/post-test.ts`.

Minimal test:

```typescript
import { assertPostMatchesReference, testPost } from 'achar';
import { registerPost } from './index';

it('matches reference output', async () => {
  const result = await testPost({
    trace: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF',
    reference: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference',
    programName: 'Setup1',
    registerPost,
  });

  assertPostMatchesReference(result);
});
```

With VMID:

```typescript
import { assertPostMatchesReference, parseVmidFile, testPost } from 'achar';
import { registerPost } from './index';

it('matches reference output and VMID contract', async () => {
  const result = await testPost({
    trace: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF',
    reference: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference',
    programName: 'Setup1',
    registerPost,
    vmid: await parseVmidFile('fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid'),
  });

  assertPostMatchesReference(result);
});
```

`testPost` returns:

```typescript
interface PostTestResult {
  files: GeneratedFile[];
  results: CompareResult[];
  summary: CompareSummary;
  vmidIssues: VmidValidationIssue[];
}
```

`assertPostMatchesReference` fails if:

- Any generated/reference file differs.
- A generated file has no reference.
- A reference file is missing from generated output.
- VMID validation has an error.

## 16. Diff Reports And Snapshot Updates

CLI diff:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

HTML report:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/report.html
```

Programmatic report:

```typescript
import { writeHtmlReport } from 'achar';

await writeHtmlReport(results, 'generated/report.html');
```

Update reference output only after reviewing the generated changes:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --update
```

Recommended policy:

- Use `--update` only on intentional post behavior changes.
- Review the changed MPF/SPF files in git.
- Run `achar test fixtures --all` after updating.
- Commit fixture/reference changes together with post changes.

## 17. Watch Mode

Watch mode exists on:

- `generate`
- `parity`
- `test`

Examples:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out generated/full --watch
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --watch
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --watch
```

Implementation detail: watch mode uses polling with `watchFile`, not `fs.watch`.
This is intentional. It works more reliably on WSL/UNC/network-like paths.

For fixture targets, Achar watches:

- Fixture manifest.
- Trace file.
- Reference MPF/SPF files.
- VMID file.
- Custom post module path when used.

When a watched file changes, Achar reruns the command.

## 18. Drivers, Built-In Posts, And Custom Posts

Drivers are controller-specific APIs layered on top of the generic `Builder`.
They are the place for things like Siemens 828D `CYCLE832`, `TRANS`, `SUPA`,
or probing cycles. Achar's core stays generic; drivers make controller dialects
pleasant and type-aware.

Use a driver from a handler:

```typescript
import { siemens828dDriver } from 'achar/posts/siemens-828d';

program.on('StartOfJob', ($) => {
  const sinumerik = $.driver(siemens828dDriver);

  sinumerik
    .DeclareReal('_camtolerance')
    .SetVariable('_camtolerance', 0.003)
    .Cycle832({ tolerance: '_camtolerance', mode: '_FINISH' })
    .Trans({ x: 0, y: 0, z: 0 });
});
```

Driver APIs are cached per builder, so repeated calls to
`$.driver(siemens828dDriver)` return the same object for the current generated
program.

Create a driver:

```typescript
import type { Builder, BuilderDriver } from 'achar';

class MyControllerDriver {
  constructor(private readonly builder: Builder) {}

  public HighAccuracyMode(tolerance: number): this {
    this.builder.Block(['G61.1', { letter: 'P', value: tolerance }]);
    return this;
  }
}

export const myControllerDriver: BuilderDriver<MyControllerDriver> = {
  id: 'my-controller',
  create: (builder) => new MyControllerDriver(builder),
};
```

Inside a driver, using lower-level builder output is acceptable. The driver is
the typed boundary that prevents post authors from scattering raw strings
through event handlers.

Built-ins are registered in `packages/core/src/lib/builtin-posts.ts`.

Current built-in:

```text
siemens-828d
```

Alias:

```text
default
```

List them:

```bash
bun run achar posts
```

Use built-in:

```json
{
  "post": "siemens-828d"
}
```

Use custom post:

```json
{
  "post": "./index.ts"
}
```

Supported post module exports:

```typescript
export function registerPost(program: Program): void {}
```

or:

```typescript
export default function registerPost(program: Program): void {}
```

or:

```typescript
export default {
  registerPost(program: Program): void {},
};
```

Compatibility export:

```typescript
export function registerDefaultPost(program: Program): void {}
```

## 19. Packaging And Public API

`package.json` exports:

```json
{
  "exports": {
    ".": "./packages/core/src/index.ts",
    "./posts/siemens-828d": "./packages/core/src/posts/siemens-828d/index.ts"
  },
  "bin": {
    "achar": "packages/cli/src/index.ts"
  }
}
```

Public imports:

```typescript
import {
  Builder,
  Parser,
  Program,
  assertPostMatchesReference,
  compareAgainstReference,
  discoverFixtures,
  generatePostFiles,
  listBuiltinPosts,
  loadFixture,
  loadPost,
  parseVmidFile,
  testPost,
  validateTraceAgainstVmid,
} from 'achar';

import { registerSiemens828dPost } from 'achar/posts/siemens-828d';
```

The package currently targets Bun. `package.json` declares:

```json
{
  "packageManager": "bun@1.3.10",
  "engines": {
    "bun": ">=1.3.0"
  }
}
```

## 20. Production Parity Workflow

Use this workflow when replacing a real GPP post:

1. Generate a trace mode 5 file from SolidCAM for a real project.
2. Save the current GPP output as reference MPF/SPF files.
3. Save the VMID.
4. Create `achar.fixture.json`.
5. Run:

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --strict-vmid
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

6. Implement or adjust post behavior.
7. Re-run until:

```text
VMID validation passed
Parity: N matched, 0 different, 0 missing generated, 0 missing reference
```

8. Add the fixture to `data` and include it in:

```bash
bun run achar test fixtures --all
```

9. Commit the fixture manifest and reference output. Vitest discovers every
   Siemens fixture manifest directly under `fixtures/` and adds it to CI parity
   coverage automatically.

The current real fixtures are green:

```text
fixtures/PROJECT_434_112466504665666_CAM_2_MILLING: 25 matched, 0 different, 0 missing generated, 0 missing reference
fixtures/PROJECT_2551019_CAM_MILLING: 92 matched, 0 different, 0 missing generated, 0 missing reference
```

Again, strict byte mode can still show differences from timestamp/trailing-space
formatting. The normal production comparison is the intended parity check.

## 21. Troubleshooting

### Command says VMID validation is skipped

You ran a raw trace without `--vmid`, or the fixture has no `vmid` field.

Fix:

```bash
bun run achar validate trace.MPF --vmid machine.vmid
```

or add:

```json
{
  "vmid": "machine.vmid"
}
```

### Missing reference

The generated file name does not match a reference MPF/SPF file.

Check:

- `programName`
- `StartOfJob` file naming logic
- `OpenFile` names
- reference directory contents

### Missing generated

The reference directory contains an MPF/SPF that Achar did not generate.

Check:

- Did your post open every required subprogram?
- Did your post skip an operation event?
- Is `--all-reference-files` enabled?

### Different only on timestamp

Normal comparison normalizes the post date line. Strict comparison does not.
Use non-strict mode for production parity unless byte-for-byte archival output
is the actual goal.

### Watch mode does not rerun

Watch mode watches files, not arbitrary generated output directories. For
fixtures it watches manifest, trace, VMID, reference files, and custom post
module path. If your post imports helper files, rerun manually or pass the
top-level post file and touch it after helper changes.

### TypeScript cannot find `achar`

Use the package export or local path consistently. From inside this repository,
Bun can self-import `achar` because `package.json` has exports. For external
projects, install or link the package.

### Handler receives wrong argument order

The order is:

```typescript
($, params, metadata)
```

not:

```typescript
(params, $)
```

## 22. Current Limits And Future Work

Achar is now usable as a framework and CLI for the current production Siemens
fixtures. Typed contexts, policies, controller capabilities, cycle objects,
linting, diagnostics, test DSLs, and VMID type generation are implemented.
Remaining practical improvements include:

- Add richer generated API docs from `packages/core/src/types.ts`.
- Watch custom post dependency graphs, not only the entry module.
- Add fixture schema validation with better JSON error messages.
- Add a compiled npm distribution for Node users if Bun should not be required.
- Add more real fixtures from different machines/controllers.
- Add explicit support for more VMID sections beyond axes and user parameters.
- Expand command helpers for common non-Siemens controller dialects.

## 23. Reference Cheat Sheets

### CLI Cheat Sheet

```bash
bun run achar --help
bun run achar parse trace.MPF --out ir.json
bun run achar vmid machine.vmid
bun run achar vmid-types machine.vmid --out vmid.generated.ts
bun run achar posts
bun run achar lint-post posts/my-post/index.ts --trace trace.MPF
bun run achar explain fixture --file OP10.SPF
bun run achar init-post posts/my-post --fixture --trace trace.MPF --reference reference --vmid machine.vmid
bun run achar validate fixture --strict-vmid
bun run achar generate fixture --out generated
bun run achar parity fixture --report report.html
bun run achar test fixture
bun run achar test fixtures-root --all
bun run achar test fixture --update
bun run achar test fixture --watch
```

### Builder Cheat Sheet

```typescript
$.Block([{ letter: 'G', value: 0 }, { letter: 'X', value: 0 }])
$.Word('D', 1)
$.G(54)
$.M(8)
$.flush()
$.BlankLine()
$.NumberedBlankLine()
$.Comment('text')
$.OpenFile('NAME', 'SPF', 'replace')
$.CloseFile()
$.Call('NAME')
$.ExtCall('NAME')
$.Rapid({ x, y, z, a, b, c })
$.RapidResolved({ x, y, z })
$.Line({ x, y, z, a, b, c })
$.LineResolved({ x, y, z })
$.LineWithFeedRateMode({ x, y, z }, 94)
$.LineWithModalWords({ x, y, z }, ['SOFT', 'G645'])
$.SetMachinePlane(plane)
$.SetSpindleSpeed(speed)
$.SetSpindleDirection(direction)
$.SetFeedRate(feed)
$.SelectTool(toolName)
$.ChangeTool()
$.UseMillimeters()
$.UseInches()
$.SetAbsoluteMode()
$.SetIncrementalMode()
$.SetFeedRateMode(94)
$.OptionalStop()
$.ProgramEnd()
$.ProgramEndAndRewind()
$.CoolantOn()
$.CoolantOff()
$.SpindleStop()
$.driver(siemens828dDriver).Cycle832({ tolerance: 0.003, mode: '_FINISH' })
```

### Fixture Cheat Sheet

```json
{
  "name": "fixture-name",
  "trace": "Setup1.MPF",
  "reference": "reference",
  "programName": "Setup1",
  "post": "siemens-828d",
  "vmid": "machine.vmid",
  "out": "../../generated/fixture-name"
}
```

### Test Helper Cheat Sheet

```typescript
import {
  assertPostMatchesReference,
  parseVmidFile,
  testPost,
} from 'achar';
import { registerPost } from './index';

const result = await testPost({
  trace: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF',
  reference: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference',
  programName: 'Setup1',
  registerPost,
  vmid: await parseVmidFile('fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid'),
});

assertPostMatchesReference(result);
```

### Production Gate

Before trusting a post change:

```bash
./node_modules/.bin/biome check .
./node_modules/.bin/tsc --noEmit
bun test
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --strict-vmid
bun run achar test fixtures --all --report /tmp/achar-report.html
```

For the current real fixtures, the expected production results are:

```text
VMID validation passed
fixtures/PROJECT_434_112466504665666_CAM_2_MILLING: 25 matched, 0 different, 0 missing generated, 0 missing reference
fixtures/PROJECT_2551019_CAM_MILLING: 92 matched, 0 different, 0 missing generated, 0 missing reference
```
