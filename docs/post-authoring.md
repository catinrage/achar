# Post Authoring

This guide is the practical workflow for writing an Achar post instead of a
SolidCAM GPP post.

## Create A Post

```bash
bun run achar init-post posts/my-controller \
  --fixture \
  --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --reference fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference \
  --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid
```

The generated post module exports `registerPost(program)`. Achar calls this
function with a `Program`, and the post registers handlers for SolidCAM trace
events.

```typescript
import type { Program } from 'achar';

export function registerPost(program: Program): void {
  program.on('StartOfFile', ($, params) => {
    $.Comment(`Part Name: ${params.part_name}`);
  });

  program.on('EndOfFile', ($) => {
    $.ProgramEndAndRewind();
  });
}

export default registerPost;
```

Handler arguments are always:

```typescript
program.on('EventName', (builder, params, metadata) => {
  // builder writes G-code.
  // params is the typed trace event payload.
  // metadata can inspect nearby events.
});
```

## Prefer Driver APIs Over Raw Output

`$.put(...)` still exists, but treat it as an escape hatch. Generic output
should use `Builder` helpers, and controller-specific output should use a
driver.

```typescript
import { siemens828dDriver } from 'achar/posts/siemens-828d';

program.on('StartOfJob', ($) => {
  const sinumerik = $.driver(siemens828dDriver);

  sinumerik
    .DeclareReal('_camtolerance')
    .SetVariable('_camtolerance', 0.003)
    .Cycle832({ tolerance: '_camtolerance', mode: '_FINISH' });
});
```

Use generic helpers for common words:

```typescript
$.Block([
  { letter: 'G', value: 0 },
  { letter: 'X', value: 10 },
  { letter: 'Y', value: 20 },
]);
$.CoolantOn();
$.SpindleStop();
$.ProgramEndAndRewind();
```

## Run A Post

Run a fixture directly:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING
```

Run all fixtures under a directory:

```bash
bun run achar test fixtures --all
```

Repository tests also discover Siemens fixture manifests directly under
`fixtures/`, so adding a new real fixture automatically expands `bun test` parity
coverage.

Generate files without comparing:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out generated/full
```

Prompt for the same inputs interactively:

```bash
bun run achar generate
```

Pass every required value as flags for scripts:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF \
  --out generated/full \
  --program-name Setup1 \
  --post siemens-828d \
  --machine-profile machines/shop-machine.machine.json
```

Keep regenerating while editing:

```bash
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --out generated/full --watch
```

## Fixture Manifest

`achar.fixture.json` keeps trace, reference, post, and VMID paths together:

```json
{
  "name": "full-siemens-828d-setup1",
  "trace": "Setup1.MPF",
  "reference": "reference",
  "programName": "Setup1",
  "post": "siemens-828d",
  "vmid": "Siemens_828D_Milling_4A.vmid",
  "machineProfile": "Siemens_828D_Milling_4A.machine.json",
  "out": "../../generated/full-siemens-828d-setup1"
}
```

`post` can be:

- `siemens-828d` or `default` for the bundled Siemens 828D post.
- A relative or absolute path to a TypeScript or JavaScript post module.

`machineProfile` is optional machine-specific generation policy. Use it for
real machine differences such as whether a final `G04F2` dwell is required.

## VMID Validation

A fixture can include `vmid`. Achar parses VMID machine metadata, axes, and
GPP user-defined parameters from `Param` and `ParamJobs`.

```bash
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --strict-vmid
```

Validation checks:

- The trace `VMID_file` matches the VMID machine name.
- Axis fields used by the trace exist in the VMID.
- GPP-style user parameters in the trace are declared in the VMID.

Warnings do not fail by default. `--strict-vmid` makes warnings fail too.

## Regression Tests

Use the same comparison engine from Vitest:

```typescript
import { assertPostMatchesReference, parseVmidFile, testPost } from 'achar';
import { registerPost } from './index';

it('matches current GPP output', async () => {
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

Use `--update` only after reviewing an intentional output change:

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --update
```

## Diff Reports

```bash
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/report.html
```

The report and CLI output include missing files plus multiple line differences
per file.

## Built-In Posts

```bash
bun run achar posts
```

The core framework does not require a Siemens controller. Siemens 828D is just
one built-in post under `src/posts/siemens-828d`.

## Scalable Post Architecture

New posts should separate orchestration, state, policy, and controller syntax:

```text
my-post/
  index.ts          Event registration only
  context.ts        Typed mutable runtime state
  policy.ts         Declarative machining decisions
  driver.ts         Controller-specific commands and cycles
  lifecycle.ts      Lifecycle handler groups
  motion.ts         Motion handler groups
```

`achar init-post` creates a context/policy/driver-based starting point.

### Typed Context And Lifecycle Helpers

```typescript
import { createPostContext, definePost, type Program } from 'achar';

export function registerPost(program: Program): void {
  const context = createPostContext(() => ({ jobs: 0, coolant: false }));
  const post = definePost(program, context, () => {});

  post.on('StartOfJob', () => context.state.jobs++);
  post.onMany(['EndOfJob', 'EndOfFile'], () => {
    context.patch({ coolant: false });
  });
}
```

Use `definePostPolicy` for immutable decisions and `extendPostPolicy` for
machine/customer variants.

### Driver Capabilities And Typed Cycles

Drivers declare capabilities through `defineDriver`. A post can use
`driverSupports` for optional behavior or `requireDriverCapability` for a clear
runtime error. Driver API types provide compile-time protection.

The Siemens driver exposes named `Cycle830Params` and a `Cycle830({...})`
method. Do not construct positional `CYCLE830(...)` strings in a post.

### Focused Test DSL

```typescript
expectPost(events, { programName: 'Part' })
  .using(registerPost)
  .toEmit('G0 X10', 'M30')
  .toEmitInOrder('T="END10"', 'M6', 'S4000')
  .notToEmit('M4');
```

Use this for focused behavior. Keep fixture golden tests for complete projects.

### Explain And Lint

```bash
achar explain fixture --file OP10.SPF --event Line
achar lint-post posts/my-post/index.ts --trace fixture/trace.MPF
achar lint-post posts/my-post/driver.ts --driver
```

`explain` reports the file, command, source event/index, listener, and optional
`CommandOptions.reason`. `lint-post` detects raw `$.put`, duplicate handlers,
controller strings outside drivers, positional cycle calls, and unhandled trace
events.

### Generate VMID Extension Types

```bash
achar vmid-types machine.vmid \
  --interface-name MachineExtensions \
  --out posts/my-post/vmid.generated.ts
```

The generated global and `StartOfJob` interfaces convert VMID parameters into
optional TypeScript fields. Regenerate the file when the VMID changes.
