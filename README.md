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
program.on('ToolChange', (params, $) => {
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
git clone https://github.com/yourusername/Achar.git
cd Achar

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Basic Example

```typescript
import { Parser } from '$src/lib/parser';
import { Program } from '$src/lib/program';

// Read SolidCAM trace file
const source = await Bun.file('./data/Setup1-TR.MPF').text();

// Parse the trace file
const parser = new Parser(source);
const parsedEvents = parser.parse();

// Create a program and define event handlers
const program = new Program();

// Define event handlers
program.on('StartOfFile', (params, $) => {
  $.put('%');  // Program start character
  $.flush();
  $.put(`O${params.program_number || 1000}`);  // Program number
  $.flush();
});

program.on('ToolChange', (params, $) => {
  $.Rapid({ z: params.clearance_plane });  // Rapid to clearance plane
  $.put(`T${params.tool_number} M6`);  // Tool change command
  $.flush();
});

// Process the events and generate G-code
program.loadEvents(parsedEvents);
program.process();
const gcode = program.generate();

// Write the G-code to a file
await Bun.write('./output/program.nc', gcode);
```

### Custom Post-Processor

To create your own post-processor:

1. Create a class that extends `Program`
2. Register event handlers for all the CAM events you need to handle
3. Use the `Builder` instance (passed as `$`) to generate G-code
4. Process your SolidCAM trace file with the custom program

## License

[MIT](LICENSE)
