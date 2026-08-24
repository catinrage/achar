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

### Docker Service

The Docker image runs two surfaces on one port: the **workshop web UI**, where
anyone in the shop uploads a Trace 5 file and gets G-code back, and the
**stateless `/v1` HTTP API** another application consumes. It does not package
the desktop app or expose the stdio MCP server.

`/v1` needs nothing persistent — every trace arrives in a request and every
result is returned in the response, and `@achar/server` has no database or
volume at all. The web UI does: `@achar/workshop` mounts its own routes on the
same kernel and keeps a job queue, machine definitions and generated output on
a volume. See [docs/workshop-ui.md](docs/workshop-ui.md).

Create the local Compose environment and replace the example token with a long
random value:

```bash
cp .env.example .env
openssl rand -hex 32
# Paste the generated value into ACHAR_SERVER_TOKEN in .env.
```

Build and start the service:

```bash
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:7788/health
```

Open `http://<host>:7788/` for the workshop UI. Add your machines under the
**ماشین‌ها** tab before the first job: a machine is what carries the post, VMID
and machine profile, and it is the reason two people posting the same trace get
the same G-code.

Compose publishes port 7788 on all interfaces so the shop floor can reach it.
**The UI has no login** — anyone who can reach the port can submit work and read
every job's output — so keep this on the workshop LAN. When Oracle runs on the
same host, configure these values in Oracle's database-backed Achar settings
UI:

```text
URL:   http://127.0.0.1:7788
Token: the ACHAR_SERVER_TOKEN value from .env
```

The URL belongs in Oracle's settings, not Oracle's environment. The token is
supplied separately to the Achar container so the two applications can
authenticate their server-to-server requests.

Operational commands:

```bash
# Follow request and startup logs
docker compose logs -f achar

# Rebuild after updating Achar
docker compose up -d --build

# Stop and remove the container; the achar-data volume survives
docker compose down

# Remove the volume too — this deletes machine definitions and job history
docker compose down -v
```

The Compose service runs as the unprivileged `bun` user with a read-only root
filesystem, all Linux capabilities dropped, a 4 GB memory limit, and the
server's default single-parse concurrency. Parsing runs in a worker process
that exits when its job finishes, so the ceiling is one trace's peak rather than
a running total: a 311 MB trace climbs to about 3.2 GB and drops back to 150 MB
the moment it completes. Do not lower the limit without measuring your own
largest trace.

Do not publish port 7788 beyond a trusted host or network. Bearer
authentication protects `/v1`, but the UI is deliberately unauthenticated and
the Trace 5 parser is intentionally treated as a trusted-network service.

To build and run without Compose:

```bash
docker build -t achar:local .
docker volume create achar-data
docker run --rm \
  --name achar \
  --memory 4g \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -v achar-data:/var/lib/achar \
  -p 127.0.0.1:7788:7788 \
  -e ACHAR_SERVER_TOKEN='replace-with-a-long-random-token' \
  achar:local
```

### CLI

For a full CLI manual, see [docs/cli-guide.md](docs/cli-guide.md). For a
zero-to-hero manual, see [docs/achar-zero-to-hero.md](docs/achar-zero-to-hero.md).
For a shorter post-author workflow, see
[docs/post-authoring.md](docs/post-authoring.md). For the empirically
established legacy GPP behavior rules that parity depends on, see
[docs/gpp-semantics.md](docs/gpp-semantics.md). To use Achar as a service from
another application, see [docs/http-server.md](docs/http-server.md).

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

# Extract per-setup and per-tool machining durations to <out>/timing.json
bun run achar timing fixtures/PROJECT_26646_CAM_Milling

# Explain why blocks were emitted
bun run achar explain fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --file F_contour8.SPF

# Check post architecture and event coverage
bun run achar lint-post packages/core/src/posts/siemens-828d/index.ts --trace fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF

# Generate typed VMID event extensions
bun run achar vmid-types fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Siemens_828D_Milling_4A.vmid --out generated/vmid.generated.ts

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
the same generation and validation core as the CLI. The view is built with
Svelte 5 and supports dark, light, and system theme modes. It supports fixture
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

### MCP Server

Achar also ships a stdio MCP server for LLM clients. It exposes tools for
listing the workspace, validating Trace 5/VMID/profile inputs, generating G-code,
and reading generated output previews.

```bash
bun run achar mcp
```

The package shortcut runs the same CLI subcommand:

```bash
bun run achar:mcp
```

For clients that run the server outside the repository directory, pass the
workspace explicitly:

```bash
ACHAR_WORKSPACE=/path/to/achar bun run achar mcp
# or
bun run achar mcp --workspace /path/to/achar
```

On Windows, use the same command from PowerShell in the project directory, or
set `ACHAR_WORKSPACE` in the client configuration. The desktop UI includes this
MCP command in its sidebar for quick client setup.

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

Set `"ignored": true` in a manifest to exclude a fixture from `achar test
--all` and the parity test suite — useful for work-in-progress fixtures whose
reference output is not trustworthy yet. Targeting the fixture directly still
runs it.

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

Event payload types live in `packages/core/src/types.ts` under `EventsType`. Command payload
types live in the builder/machine APIs. The Siemens 828D built-in post in
`packages/core/src/posts/siemens-828d` is the current production-parity reference
implementation; `packages/core/src/lib/default-post.ts` remains as a compatibility re-export.

### Basic Example

```typescript
import { Parser, Program } from 'achar';

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
