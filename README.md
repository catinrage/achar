# Achar

A modern TypeScript-based post-processor for converting SolidCAM trace output into G-code for CNC machines.

## Overview

Achar is a replacement for SolidCAM's GPP (General Post Processor) language, using TypeScript instead. It allows you to define post-processing logic in a more modern, type-safe language with better tooling, while maintaining the event-driven approach familiar to CAM post-processor developers.

## Project Goal

The primary goal of this project is to provide a more flexible and maintainable alternative to writing post-processors in SolidCAM's proprietary GPP language. By using TypeScript, developers gain access to:

- Modern language features and syntax
- Strong type checking and code completion
- Better debugging tools
- Access to the entire Node.js ecosystem
- Version control compatibility
- Testing frameworks

## How It Works

Achar takes the detailed trace output from SolidCAM (trace mode 5) and transforms it into G-code through the following process:

1. **Parse**: The `Parser` reads SolidCAM's trace output which contains events like `StartOfFile`, `ToolChange`, `Line`, etc.
2. **Process**: The `Program` processes these events through registered event listeners
3. **Generate**: The event listeners use a `Builder` to construct G-code commands
4. **Output**: The final G-code is returned as a string

## Core Architecture

The project consists of four main components:

### 1. Parser (`parser.ts`)

Parses the SolidCAM trace output (a multi-line string) into structured event data:

- Identifies event blocks (e.g., `(0)@start_of_file`) 
- Extracts key-value pairs for each event
- Converts values to appropriate types (string, number, boolean, or specialized enums)
- Organizes events into an array of `EventData` objects

### 2. Program (`program.ts`)

Orchestrates the G-code generation process:

- Loads parsed events 
- Allows registration of event handlers via the `on()` method
- Processes events in sequence, triggering the appropriate handlers
- Provides an event-driven programming model

### 3. Builder (`builder.ts`)

Constructs G-code, handling:

- Line numbers and formatting
- Command accumulation and flushing
- High-level G-code operations (e.g., `Rapid`, `Line`, `SetSpindleSpeed`, etc.)

### 4. Machine (`machine.ts`)

Represents the state of the CNC machine:

- Tracks current positions, modes, and settings
- Ensures G-code is only output when values change
- Converts logical operations into specific G-code words

## Technical Details

### Event-Driven Approach

Like SolidCAM's GPP, Achar uses an event-driven programming model where you register handlers for specific CAM events:

```typescript
program.on('ToolChange', ($, params) => {
  $.Rapid({ z: params.clearance_plane });
  $.SetSpindleSpeed(params.speed);
  $.SetSpindleDirection(params.direction);
});
```

Events are triggered in the order they appear in the trace file, and multiple handlers for the same event are executed in the order they were registered.

### Type System

The project leverages TypeScript's type system extensively:

- `EventsType` defines the structure of parameters for each event type
- `CommandsType` defines the parameters for G-code generation commands
- Generic types ensure type safety throughout the event pipeline

### Memory Efficiency

The `Machine` class uses a `Wrapper` pattern to track state changes and avoid generating redundant G-code. For example, if the spindle speed is already set to 1000, setting it to 1000 again won't generate a duplicate S-word.

## Installation

```bash
# Clone the repository
git clone https://github.com/catinrage/Achar.git
cd Achar

# Install dependencies
bun install

# Check the project
bun run format-and-lint
bun test
```

## Usage

### CLI

For a full CLI manual, see [docs/cli-guide.md](docs/cli-guide.md). For a
zero-to-hero manual, see [docs/achar-zero-to-hero.md](docs/achar-zero-to-hero.md).
For a shorter post-author workflow, see
[docs/post-authoring.md](docs/post-authoring.md).

```bash
# Parse a SolidCAM trace into Achar IR
bun run achar parse fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF --out generated/Setup1.ir.json

# Inspect a VMID file
bun run achar vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid

# List bundled posts
bun run achar posts

# Create a custom post skeleton
bun run achar init-post posts/my-controller --fixture --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF --reference fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference --vmid fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid

# Validate a trace/fixture against its VMID
bun run achar validate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING

# Generate MPF/SPF files from a fixture
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING

# Prompt for generate inputs interactively
bun run achar generate

# Generate from a raw trace with explicit flags
bun run achar generate fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF --out generated/full --program-name Setup1 --post siemens-828d

# Compare Achar output against existing GPP output and write an HTML report
bun run achar parity fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --report generated/full-report.html

# Run a golden-output post regression test
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING

# Run every fixture under a directory
bun run achar test fixtures --all

# Explain why blocks were emitted
bun src/cli.ts explain fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --file F_contour8.SPF

# Check post architecture and event coverage
bun src/cli.ts lint-post src/posts/siemens-828d/index.ts --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF

# Generate typed VMID event extensions
bun src/cli.ts vmid-types fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid --out generated/vmid.generated.ts

# Keep rerunning while editing a post, trace, VMID, or reference output
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --watch
```

Use `achar test` for CI and regression testing; it always fails on any mismatch.
Use `--strict` when byte-level output should be compared without timestamp
normalization. Use `--update` only when you intentionally want to refresh golden
reference output after reviewing a post change.
The `generate` command prints a final summary with the number of files written
and the elapsed time.

### Desktop UI

The Electrobun desktop app is primarily packaged for Windows 11 x64 and exposes
the same generation and validation core as the CLI. It supports fixture
selection, custom Trace 5/VMID/profile paths, native file dialogs, parity
status, diagnostics, generated-file browsing, and G-code preview. The Windows
build uses the installed Microsoft Edge WebView2 runtime instead of bundling
Chromium, keeping the application package smaller.

```bash
# Build and run once
bun run desktop

# Rebuild when desktop source files change
bun run desktop:dev

# Create a stable artifact for the current development platform
bun run desktop:build

# Create the Windows release on a Windows x64 host or CI runner
bun run desktop:build:windows
```

Electrobun 1.18 builds for the current host platform, so the Windows release
command intentionally rejects non-Windows hosts. Windows 11 provides WebView2;
older or stripped-down installations must install the WebView2 Evergreen
Runtime. Linux remains useful for development and requires GTK 3 and WebKitGTK
4.1 development/runtime packages.

### Fixture Manifests

A fixture is a directory with `achar.fixture.json`. It tells Achar how to run a
real post test without repeating long command-line flags:

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

`post` can be a built-in post name (`default` or `siemens-828d`) or a path to a
TypeScript/JavaScript module. A post module can export any of these shapes:

```typescript
import type { Program } from 'achar';

export function registerPost(program: Program): void {
  program.on('StartOfFile', ($) => {
    $.UseMillimeters();
  });
}

export default registerPost;
```

Use `achar init-post <directory>` to create the same shape automatically. With
`--fixture`, it also writes an `achar.fixture.json` so the new post can be run
through `achar test` immediately.

### VMID Validation

Fixtures can include a VMID file. Achar parses VMID machine metadata, axes, post
processor names, and user-defined parameters (`Param` and `ParamJobs`). During
validation it checks that:

- The trace `VMID_file` matches the VMID machine name.
- Axis words used by the trace exist in the VMID.
- GPP-style user parameters in the trace are declared in the VMID.

Warnings do not fail by default. Add `--strict-vmid` when warnings should fail
the command too.

### Post Regression Tests

Achar exposes the same comparison engine as a TypeScript test helper, so post
developers can keep golden output tests next to their post code:

```typescript
import { assertPostMatchesReference, testPost } from 'achar';
import { registerSiemens828dPost } from './siemens-828d-post';

it('matches the current Siemens GPP output', async () => {
  const result = await testPost({
    trace: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF',
    reference: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference',
    out: 'generated/full',
    programName: 'Setup1',
    registerPost: (program) => registerSiemens828dPost(program),
  });

  assertPostMatchesReference(result);
});
```

The assertion reports differing files and line snippets, plus missing generated
or reference files. When a VMID is supplied, validation errors are included in
the assertion failure. That makes post changes suitable for CI: if a developer
changes tool change, coolant, cycle, or motion logic, the golden test tells
exactly what output changed.

### Event and Type Surface

Post authors usually work with these exported APIs:

- `Program`: registers event handlers with `program.on(eventName, handler)`.
- `Builder`: handler API for writing G-code and higher-level motion commands.
- `Parser`: converts SolidCAM trace mode 5 output into structured events.
- `testPost` and `assertPostMatchesReference`: golden-output regression helpers.
- `loadFixture`, `discoverFixtures`, and `loadPost`: CLI-compatible fixture and post loading.
- `parseVmidFile` and `validateTraceAgainstVmid`: VMID-aware validation helpers.

Event payload types live in `src/types.ts` under `EventsType`. Command payload
types live in the builder/machine APIs. The Siemens 828D built-in post in
`src/posts/siemens-828d` is the current production-parity reference
implementation; `src/lib/default-post.ts` remains as a compatibility re-export.

### Basic Example

```typescript
import { Parser } from '$src/lib/parser';
import { Program } from '$src/lib/program';

// Read SolidCAM trace file
const source = await Bun.file('./fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF').text();

// Parse the trace file
const parser = new Parser(source);
const parsedEvents = parser.parse();

// Create a program and define event handlers
const program = new Program();

// Define event handlers
program.on('StartOfFile', ($, params) => {
  $.Comment(`Program: ${params.program_number || 1000}`);
  $.UseMillimeters();
  $.SetAbsoluteMode();
});

program.on('ToolChange', ($, params) => {
  $.Rapid({ z: params.clearance_plane });  // Rapid to clearance plane
  $.SelectTool(String(params.tool_number)).ChangeTool();
});

// Process the events and generate G-code
program.loadEvents(parsedEvents);
program.process();
const gcode = program.generate();

// Write the G-code to a file
for (const file of gcode) {
  await Bun.write(`./output/${file.file}`, file.code);
}
```

### Custom Post-Processor

To create your own post-processor:

1. Create a class that extends `Program`
2. Register event handlers for all the CAM events you need to handle
3. Use the `Builder` instance (passed as `$`) to generate G-code
4. Process your SolidCAM trace file with the custom program

## License

[MIT](LICENSE)
