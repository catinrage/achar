# Achar Test Suite

This directory contains comprehensive tests for the Achar CNC post-processor.

## Test Organization

### Unit Tests
Located in `src/lib/*.spec.ts`, these tests cover individual components:
- **Parser Tests** (`src/lib/parser.spec.ts`): Tests the SolidCAM trace file parser
- **Machine Tests** (`src/lib/machine.spec.ts`): Tests the machine state management
- **Program Tests** (`src/lib/program.spec.ts`): Tests the event-driven program orchestration
- **Builder Tests** (`src/lib/builder.spec.ts`): Tests the G-code generation builder
- **Emitter Tests** (`src/lib/emitter.spec.ts`): Tests the stateful G-code emitters

### End-to-End Tests
Located in `test/e2e/e2e.test.ts`, these tests cover the complete pipeline:

#### Test Categories

1. **Basic Pipeline Tests**
   - Complete trace file processing through the entire pipeline
   - Handling of empty trace files
   - Event processing order preservation

2. **Multiple Operation Types**
   - Setup files with multiple machining operations
   - Different setup file processing
   - Subprogram generation validation

3. **Event Handler Functionality**
   - Event handler triggering with correct parameters
   - Event metadata provision
   - Multiple handlers for same event

4. **G-code Output Validation**
   - Valid G-code structure generation
   - Coordinate system handling
   - Tool change command generation

5. **Error Handling and Edge Cases**
   - Malformed trace file handling
   - Events with no registered handlers
   - Empty parameter events

6. **Performance and Scalability**
   - Large trace file processing efficiency
   - Multiple program instance handling

7. **Integration with Real Data**
   - Processing of all available setup files
   - Consistency across different trace files

### Post Golden Tests
Located in `src/lib/post-test.spec.ts`, these tests cover the post regression
test harness. Post developers can use the same helpers in their own Vitest
files to compare generated MPF/SPF output against known-good GPP output.

## Running Tests

```bash
# Run all tests
bun test

# Run only unit tests
bun test src/lib/

# Run only e2e tests
bun test test/e2e/

# Run with coverage
bun test --coverage

# Run a post regression test from the CLI
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING

# Run every fixture under a directory
bun run achar test fixtures --all

# Refresh golden output after reviewing an intentional post change
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --update

# Keep rerunning while editing a post or fixture
bun run achar test fixtures/PROJECT_434_112466504665666_CAM_2_MILLING --watch
```

## Test Data

The e2e tests use real SolidCAM trace files from the `fixtures/` directory:
- `Setup1-TR.MPF` through `Setup4-TR.MPF`: Complete machining setups
- Various operation-specific files for specialized testing
- `fixtures/PROJECT_434_112466504665666_CAM_2_MILLING`: Production-style fixture with trace mode 5 output, VMID, current GPP post, and reference G-code

## Key Test Patterns

### Event Handler Testing
```typescript
program.on('StartOfFile', ($, params) => {
  // Set up machine initial state
  $.UseMillimeters();
  $.SetAbsoluteMode();
});
```

### Pipeline Testing
```typescript
const events = loadTraceFile('Setup1-TR.MPF');
setupBasicEventHandlers(program);
program.loadEvents(events);
program.process();
const output = program.generate();
```

### Output Validation
```typescript
expect(output).toBeInstanceOf(Array);
expect(mainFile.code).toContain('G710'); // Metric units
expect(mainFile.code).toContain('M30');  // End of program
```

### Golden Post Regression Testing
```typescript
import { assertPostMatchesReference, testPost } from 'achar';
import { registerMyPost } from '../src/my-post';

it('matches the proven GPP output', async () => {
  const result = await testPost({
    trace: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/Setup1.MPF',
    reference: 'fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/reference',
    out: 'generated/full',
    programName: 'Setup1',
    registerPost: (program) => registerMyPost(program),
  });

  assertPostMatchesReference(result);
});
```

`assertPostMatchesReference` throws with the differing files and lines, so the
test fails in CI when a post change modifies output unexpectedly. If the test
passes a parsed VMID to `testPost`, VMID validation errors are included in the
same assertion failure.

### Fixture Test Workflow

Use `achar.fixture.json` when a real project needs more than a trace path:

```json
{
  "trace": "Setup1.MPF",
  "reference": "reference",
  "programName": "Setup1",
  "post": "siemens-828d",
  "vmid": "Siemens_828D_Milling_4A.vmid"
}
```

This lets post authors run the same fixture from the CLI and from automated
tests without duplicating paths or post configuration.

## Test Coverage

The test suite provides comprehensive coverage of:
- ✅ Parser functionality with various input formats
- ✅ Machine state management and optimization
- ✅ Event-driven program orchestration
- ✅ G-code generation and formatting
- ✅ Complete pipeline integration
- ✅ Error handling and edge cases
- ✅ Performance characteristics
- ✅ Real-world data compatibility

## Development Guidelines

When adding new features:

1. **Add Unit Tests**: Test individual components in isolation
2. **Update E2E Tests**: Ensure new functionality works in the complete pipeline
3. **Test Real Data**: Verify compatibility with actual SolidCAM trace files
4. **Performance Testing**: Ensure new features don't degrade performance
5. **Error Handling**: Test both success and failure scenarios

## Debugging Failed Tests

For debugging test failures:

```bash
# Run tests with verbose output
bun test --verbose

# Run a specific test file
bun test test/e2e/e2e.test.ts

# Run a specific test case
bun test -t "should process a complete trace file"
```

The e2e tests include detailed console output for successful file processing, making it easy to identify which files are being processed and their outcomes.
