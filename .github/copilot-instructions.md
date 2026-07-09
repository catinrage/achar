# Achar CNC Post-Processor Copilot Instructions

This document provides guidance for AI agents working on the Achar codebase. Achar is a TypeScript-based post-processor for converting SolidCAM trace output into G-code for CNC machines, intended as a modern replacement for the proprietary GPP language.

## Core Architecture & Data Flow

The core of the application follows an event-driven data pipeline. Understanding this flow is critical.

1.  **`Parser` (`src/lib/parser.ts`)**: Reads raw SolidCAM trace files (like those in the `data/` directory) which are multi-line string files. It parses these into a structured array of `EventData` objects. Each event has a name (e.g., `ToolChange`) and a set of parameters.

2.  **`Program` (`src/lib/program.ts`)**: This is the central orchestrator. It loads the events from the parser and processes them sequentially. Its main purpose is to provide an event-driven interface where you can register handlers for specific events using the `program.on('EventName', handler)` method.

3.  **`Builder` (`src/lib/builder.ts`)**: A fluent API for constructing G-code. An instance of the builder is passed as the second argument (`$`) to every event handler. You use it to generate G-code commands like `$.Rapid(...)` or `$.Line(...)`.

4.  **`Machine` (`src/lib/machine.ts`)**: This is a state machine that represents the CNC machine's state (e.g., current position, spindle speed, active tool). The `Builder` uses the `Machine` to avoid generating redundant G-code. For example, if the spindle speed is already 1000 RPM, `$.SetSpindleSpeed(1000)` will not emit a new `S1000` command.

The typical data flow is:
`SolidCAM File -> Parser -> Program -> [Event Handlers] -> Builder -> Machine -> G-Code String`

## Developer Workflow

-   **Development & Experimentation**: The primary file for development and debugging is `src/playground.ts`. It's configured to be run with `bun run dev`, which provides a live-reloading environment. Use this file to load trace files from `data/` and test your post-processor logic.

-   **Package Management**: The project uses Bun as the primary package manager and runtime. Always prefer Bun (bunx over npx) commands over npm when available:
    -   Use `bun install` instead of `npm install`
    -   Use `bun run <script>` instead of `npm run <script>`
    -   Use `bun test` instead of `npm test`
    -   Use `bun add <package>` instead of `npm install <package>`

-   **Testing**: The project uses Vitest for unit testing. Test files are located in the `tests/` directory and mirror the `src/lib` structure. You can run all tests using `bun test`.

-   **Quality Assurance**: After completing any task or making changes to code files (TypeScript, JavaScript, or other source files), always perform the following validation steps. Skip these steps for documentation-only changes (e.g., markdown files, README updates):
    -   **Type Checking**: Run `bunx tsc --noEmit` to check for TypeScript type errors. The codebase must be free of type errors before considering a task complete.
    -   **Test Execution**: Run `bun test` to execute the test suite and ensure no existing functionality is broken. All tests must pass.

-   **Testing Requirements**: The project follows a comprehensive testing strategy to ensure code quality and prevent regressions:
    -   **New Code Coverage**: Every new piece of code must be accompanied by corresponding tests. No functionality should be added without proper test coverage.
    -   **Test Maintenance**: When existing code is updated or modified, the associated tests must also be updated to reflect the changes and maintain accuracy.
    -   **Regression Prevention**: When fixing bugs, always write tests that specifically verify the bug is resolved and prevent it from reoccurring in the future.
    -   **Edge Case Testing**: When writing tests, always consider and test edge cases, boundary conditions, error scenarios, and unusual inputs to ensure robust code behavior.

-   **Commit Message Convention**: Always follow conventional commit message format when making commits. Use the format `<type>(<scope>): <description>` where:
    -   **Type**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
    -   **Scope**: Optional, indicates the area of change (e.g., `parser`, `builder`, `machine`)
    -   **Description**: Clear, concise description of the change in imperative mood
    -   **Commit Strategy**: Group related changes together in logical commits. Avoid committing all changes at once if they address different concerns or components.
    -   Examples: `feat(parser): add support for new event types`, `fix(builder): resolve coordinate precision issues`, `docs: update API documentation`

## Key Conventions & Patterns

-   **Event-Driven Logic**: The main way to define the post-processor's behavior is by registering handlers to events. The logic is defined by how you react to the sequence of events from the CAM file.

    ```typescript
    // In a custom Program class or in playground.ts
    program.on('ToolChange', (params, $) => {
      // Use the builder ($) to generate G-code in response to a ToolChange event
      $.Rapid({ z: params.clearance_plane });
      $.put(`T${params.tool_number} M6`);
      $.flush();
    });
    ```

-   **Typed Events**: The parameters for each event are strongly typed. See `src/types.ts` for the `EventsType` interface, which maps event names to their specific parameter types. This enables type-safe access to event data within handlers.

-   **G-Code Generation via Builder**: Always use the `Builder` instance (`$`) provided to handlers to generate G-code. This ensures that the machine state is correctly tracked and the output is optimized. Direct string manipulation should be rare.

-   **Stateful Machine**: Remember that the `Machine` class tracks state. When you call a builder method, it first checks the machine's current state. The G-code is only generated if a value is actually changing. This is the key to generating clean, efficient G-code.
