import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type CommandsType,
  type EventListenerMetadata,
  type EventsType,
  FeedRateModeEnum,
  Parser,
  Program,
} from '@achar/core';

interface ConsistencyResult {
  filename: string;
  fileCount: number;
  hasMainFile: boolean;
  mainFileLength: number;
  containsUnits: boolean | undefined;
  containsAbsolute: boolean | undefined;
  containsEndProgram: boolean | undefined;
}

const TRACE_FILES: Record<string, string> = {
  'Setup1-TR.MPF':
    '../../fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/434_112466504665666_CAM_2_Milling.MPF',
  'Setup2-TR.MPF':
    '../../fixtures/PROJECT_2551019_CAM_MILLING/2551019_CAM_MILLING.MPF',
  'Setup3-TR.MPF':
    '../../fixtures/PROJECT_567_112250296390862_CAM_Milling/567_112250296390862_CAM_Milling.MPF',
  'Setup4-TR.MPF':
    '../../fixtures/PROJECT_434_112466504665666_CAM_2_MILLING/434_112466504665666_CAM_2_Milling.MPF',
};
const traceCache = new Map<string, ReturnType<Parser['parse']>>();

describe('E2E Tests - Complete Pipeline', () => {
  let program: Program;

  beforeEach(() => {
    program = new Program({
      programName: 'TestSetup',
      numbering: {
        enabled: true,
        start: 100,
        increment: 10,
      },
    });
  });

  /**
   * Helper function to load and parse a trace file
   */
  const loadTraceFile = (filename: string) => {
    const cached = traceCache.get(filename);
    if (cached) return cached;

    const tracePath = TRACE_FILES[filename];
    if (!tracePath) {
      throw new Error(`Unknown fixture trace alias: ${filename}`);
    }
    const filePath = path.join(__dirname, tracePath);
    const content = readFileSync(filePath, 'utf-8');
    const parser = new Parser(content);
    const events = parser.parse();
    traceCache.set(filename, events);
    return events;
  };

  /**
   * Helper function to set up basic event handlers for testing
   */
  const setupBasicEventHandlers = (program: Program) => {
    program.on('StartOfFile', ($, params) => {
      if (params.inch_system) {
        $.UseInches({ skipNewLine: true });
      } else {
        $.UseMillimeters({ skipNewLine: true });
      }
      $.SetFeedRateMode(FeedRateModeEnum.UNITS_PER_MINUTE, {
        skipNewLine: true,
      });
      $.SetAbsoluteMode({ skipNewLine: true });
    });

    program.on('MachinePlane', ($, params) => {
      $.SetMachinePlane(params.machine_plane);
    });

    program.on('StartOfJob', ($, params) => {
      $.OpenFile(params.job_name);
    });

    program.on('EndOfJob', ($) => {
      $.CloseFile();
    });

    program.on('ToolChange', ($, params) => {
      if (params.clearance_plane !== undefined) {
        $.Rapid({ z: params.clearance_plane });
      }
      $.SelectTool(params.tool_name || `T${params.tool_number}`);
      $.ChangeTool();
    });

    program.on('MFeedSpin', ($, params) => {
      $.SetSpindleSpeed(params.spin);
      $.SetSpindleDirection(params.spin_direction);
    });

    program.on('RapidMove', ($, params) => {
      const coords: CommandsType['Rapid'] = {};
      if (params.xpos !== undefined) coords.x = params.xpos;
      if (params.ypos !== undefined) coords.y = params.ypos;
      if (params.zpos !== undefined) coords.z = params.zpos;
      $.Rapid(coords);
    });

    program.on('Line', ($, params) => {
      const coords: CommandsType['Line'] = {};
      if (params.xpos !== undefined) coords.x = params.xpos;
      if (params.ypos !== undefined) coords.y = params.ypos;
      if (params.zpos !== undefined) coords.z = params.zpos;
      if (params.feed !== undefined) {
        $.SetFeedRate(params.feed);
      }
      $.Line(coords);
    });

    program.on('EndOfFile', ($) => {
      $.put('M30'); // End of program
    });
  };

  describe('Basic Pipeline Tests', () => {
    it('should process a complete trace file through the entire pipeline', async () => {
      // Load and parse events
      const events = loadTraceFile('Setup1-TR.MPF');

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]._eventName).toBe('StartOfFile');
      expect(events[events.length - 1]._eventName).toBe('EndOfFile');

      // Set up event handlers
      setupBasicEventHandlers(program);

      // Load events into program
      program.loadEvents(events);

      // Process events
      program.process();

      // Generate G-code
      const output = program.generate();

      // Verify output structure
      expect(output).toBeInstanceOf(Array);
      expect(output.length).toBeGreaterThan(0);

      // Check main file exists
      const mainFile = output.find((file) => file.file.includes('.MPF'));
      expect(mainFile).toBeDefined();
      expect(mainFile?.code).toMatch(/N\d+/); // Should have line numbers
      expect(mainFile?.code).toContain('G710'); // Should have metric units
      expect(mainFile?.code).toContain('M30'); // Should have end of program
    });

    it('should handle trace files with no events gracefully', () => {
      const parser = new Parser('');
      const events = parser.parse();

      expect(events).toHaveLength(0);

      program.loadEvents(events);
      program.process();

      const output = program.generate();
      expect(output).toHaveLength(1);
      expect(output[0].file).toBe('TestSetup.MPF');
      expect(output[0].code).toBe(''); // Empty program
    });

    it('should preserve event order during processing', () => {
      const events = loadTraceFile('Setup1-TR.MPF');

      // Track the order of events processed
      const processedEvents: string[] = [];

      program.on('StartOfFile', () => {
        processedEvents.push('StartOfFile');
      });

      program.on('ToolChange', () => {
        processedEvents.push('ToolChange');
      });

      program.on('EndOfFile', () => {
        processedEvents.push('EndOfFile');
      });

      program.loadEvents(events);
      program.process();

      // Verify events were processed in correct order
      expect(processedEvents[0]).toBe('StartOfFile');
      expect(processedEvents[processedEvents.length - 1]).toBe('EndOfFile');
    });
  });

  describe('Multiple Operation Types', () => {
    it('should handle Setup files with multiple operations', () => {
      const events = loadTraceFile('Setup1-TR.MPF');
      setupBasicEventHandlers(program);

      program.loadEvents(events);
      program.process();

      const output = program.generate();

      // Should have main file plus subprograms
      expect(output.length).toBeGreaterThan(1);

      // Check that subprograms are created
      const subPrograms = output.filter((file) => file.file.includes('.SPF'));
      expect(subPrograms.length).toBeGreaterThan(0);

      // Each subprogram should have valid G-code
      const nonEmptySubPrograms = subPrograms.filter(
        (subProgram) => subProgram.code.length > 0,
      );
      expect(nonEmptySubPrograms.length).toBeGreaterThan(0);
      nonEmptySubPrograms.forEach((subProgram) => {
        expect(subProgram.code).toContain('N');
      });
    });

    it('should process different setup files correctly', () => {
      const setupFiles = ['Setup1-TR.MPF', 'Setup2-TR.MPF', 'Setup3-TR.MPF'];

      for (const filename of setupFiles) {
        const events = loadTraceFile(filename);
        const testProgram = new Program({
          programName: `Test_${filename.replace('.MPF', '')}`,
          numbering: { enabled: true, start: 100, increment: 10 },
        });

        setupBasicEventHandlers(testProgram);
        testProgram.loadEvents(events);
        testProgram.process();

        const output = testProgram.generate();

        // Basic validation
        expect(output.length).toBeGreaterThan(0);
        const mainFile = output.find((file) => file.file.includes('.MPF'));
        expect(mainFile).toBeDefined();
        expect(mainFile?.code).toBeTruthy();
      }
    }, 15_000);
  });

  describe('Event Handler Functionality', () => {
    it('should trigger event handlers with correct parameters', () => {
      const events = loadTraceFile('Setup1-TR.MPF');

      const received: {
        startOfFileParams?: EventsType['StartOfFile'];
        toolChangeParams?: EventsType['ToolChange'];
      } = {};

      program.on('StartOfFile', (_$, params) => {
        received.startOfFileParams = params;
      });

      program.on('ToolChange', (_$, params) => {
        received.toolChangeParams = params;
      });

      program.loadEvents(events);
      program.process();

      // Verify event handlers were called with parameters
      expect(received.startOfFileParams).toBeTruthy();
      if (!received.startOfFileParams) {
        throw new Error('StartOfFile handler was not called');
      }
      expect(received.startOfFileParams.program_number).toBeDefined();

      const toolChangeParams = received.toolChangeParams;
      if (toolChangeParams) {
        expect(toolChangeParams.tool_number).toBeDefined();
      }
    });

    it('should provide correct metadata to event handlers', () => {
      const events = loadTraceFile('Setup1-TR.MPF');

      const received: { metadata?: EventListenerMetadata } = {};

      program.on('StartOfFile', (_$, _params, metadata) => {
        received.metadata = metadata;
      });

      program.loadEvents(events);
      program.process();

      expect(received.metadata).toBeTruthy();
      if (!received.metadata) {
        throw new Error('StartOfFile metadata was not received');
      }
      expect(received.metadata.index).toBe(0);
      expect(typeof received.metadata.currentFile).toBe('function');
      expect(received.metadata.previous).toBeNull();
      expect(received.metadata.next).toBeTruthy();
    });

    it('should handle multiple handlers for the same event', () => {
      const events = loadTraceFile('Setup1-TR.MPF');

      let handler1Called = false;
      let handler2Called = false;

      program.on('StartOfFile', () => {
        handler1Called = true;
      });

      program.on('StartOfFile', () => {
        handler2Called = true;
      });

      program.loadEvents(events);
      program.process();

      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);
    });
  });

  describe('G-code Output Validation', () => {
    it('should generate valid G-code structure', () => {
      const events = loadTraceFile('Setup1-TR.MPF');
      setupBasicEventHandlers(program);

      program.loadEvents(events);
      program.process();

      const output = program.generate();
      const mainFile = output.find((file) => file.file.includes('.MPF'));

      expect(mainFile).toBeDefined();
      const gcode = mainFile?.code;
      if (!gcode) {
        throw new Error('Main file G-code was not generated');
      }

      // Check for proper line numbering
      expect(gcode).toMatch(/N\d+/);

      // Check for proper G-code structure
      expect(gcode).toMatch(/G\d+/);

      // Check for end of program
      expect(gcode).toContain('M30');

      // Verify no empty lines in middle of program
      const lines = gcode.split('\n').filter((line) => line.trim() !== '');
      expect(lines.length).toBeGreaterThan(0);

      // Each line should start with N (line number) or be empty
      lines.forEach((line) => {
        if (line.trim() !== '') {
          expect(line.trim()).toMatch(/^N\d+/);
        }
      });
    });

    it('should handle coordinate systems correctly', () => {
      const events = loadTraceFile('Setup1-TR.MPF');
      setupBasicEventHandlers(program);

      program.loadEvents(events);
      program.process();

      const output = program.generate();
      const mainFile = output.find((file) => file.file.includes('.MPF'));

      expect(mainFile).toBeDefined();
      const gcode = mainFile?.code;

      // Should contain coordinate system setup
      expect(gcode).toMatch(/G\d+/); // Motion commands
      expect(gcode).toContain('G710'); // Metric units
      expect(gcode).toContain('G90'); // Absolute positioning
    });

    it('should handle tool changes properly', () => {
      const events = loadTraceFile('Setup1-TR.MPF');
      setupBasicEventHandlers(program);

      program.loadEvents(events);
      program.process();

      const output = program.generate();
      const allCode = output.map((file) => file.code).join('\n');

      // Should contain tool selection and change commands
      if (allCode.includes('T')) {
        expect(allCode).toMatch(/T[="]/); // Tool selection
        expect(allCode).toContain('M6'); // Tool change
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed trace files gracefully', () => {
      const malformedInput = `
        Invalid line without event
        (0)@invalid_event
        malformed : 
        : value_without_key
        (1)@valid_event
        valid_param : 123
      `;

      const parser = new Parser(malformedInput);
      const events = parser.parse();

      // Should still parse valid events
      expect(events.length).toBeGreaterThan(0);

      program.loadEvents(events);
      program.process();

      const output = program.generate();
      expect(output).toHaveLength(1);
    });

    it('should handle events with no registered handlers', () => {
      const events = loadTraceFile('Setup1-TR.MPF');

      // Don't register any handlers
      program.loadEvents(events);
      program.process();

      const output = program.generate();
      expect(output).toHaveLength(1);
      expect(output[0].code).toBe(''); // No G-code generated
    });

    it('should handle empty parameter events', () => {
      const input = `
        (0)@start_of_file
        (1)@tool_change
        (2)@end_of_file
      `;

      const parser = new Parser(input);
      const events = parser.parse();

      program.on('StartOfFile', ($) => {
        $.put('G710 G90');
      });

      program.on('ToolChange', ($) => {
        $.put('M6');
      });

      program.on('EndOfFile', ($) => {
        $.put('M30');
      });

      program.loadEvents(events);
      program.process();

      const output = program.generate();
      expect(output[0].code).toContain('G710');
      expect(output[0].code).toContain('M6');
      expect(output[0].code).toContain('M30');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large trace files efficiently', () => {
      const events = loadTraceFile('Setup1-TR.MPF');

      // Measure processing time
      const startTime = Date.now();

      setupBasicEventHandlers(program);
      program.loadEvents(events);
      program.process();

      const output = program.generate();

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should complete within reasonable time (adjust threshold as needed)
      expect(processingTime).toBeLessThan(5000); // 5 seconds

      // Should produce valid output
      expect(output.length).toBeGreaterThan(0);
      expect(output[0].code).toBeTruthy();
    });

    it('should handle multiple program instances', () => {
      const events = loadTraceFile('Setup1-TR.MPF');

      const programs = Array.from(
        { length: 3 },
        (_, i) =>
          new Program({
            programName: `TestProgram${i}`,
            numbering: { enabled: true, start: 100, increment: 10 },
          }),
      );

      programs.forEach((prog, index) => {
        setupBasicEventHandlers(prog);
        prog.loadEvents(events);
        prog.process();

        const output = prog.generate();
        expect(output.length).toBeGreaterThan(0);
        expect(output[0].file).toContain(`TestProgram${index}`);
      });
    });
  });

  describe('Integration with Real Data', () => {
    it('should process all available setup files without errors', () => {
      const setupFiles = [
        'Setup1-TR.MPF',
        'Setup2-TR.MPF',
        'Setup3-TR.MPF',
        'Setup4-TR.MPF',
      ];

      for (const filename of setupFiles) {
        try {
          const events = loadTraceFile(filename);
          const testProgram = new Program({
            programName: `Test_${filename.replace('.MPF', '')}`,
            numbering: { enabled: true, start: 100, increment: 10 },
          });

          setupBasicEventHandlers(testProgram);
          testProgram.loadEvents(events);
          testProgram.process();

          const output = testProgram.generate();

          // Basic validation
          expect(output.length).toBeGreaterThan(0);

          // Should have main file
          const mainFile = output.find((file) => file.file.includes('.MPF'));
          expect(mainFile).toBeDefined();

          console.log(
            `✓ Successfully processed ${filename}: ${output.length} files generated`,
          );
        } catch (error) {
          console.error(`✗ Failed to process ${filename}:`, error);
          throw error;
        }
      }
    }, 15_000);

    it('should maintain consistency across different trace files', () => {
      const setupFiles = ['Setup1-TR.MPF', 'Setup2-TR.MPF'];
      const results: ConsistencyResult[] = [];

      for (const filename of setupFiles) {
        const events = loadTraceFile(filename);
        const testProgram = new Program({
          programName: `Test_${filename.replace('.MPF', '')}`,
          numbering: { enabled: true, start: 100, increment: 10 },
        });

        setupBasicEventHandlers(testProgram);
        testProgram.loadEvents(events);
        testProgram.process();

        const output = testProgram.generate();
        const mainFile = output.find((file) => file.file.includes('.MPF'));

        results.push({
          filename,
          fileCount: output.length,
          hasMainFile: !!mainFile,
          mainFileLength: mainFile?.code.length || 0,
          containsUnits:
            mainFile?.code.includes('G710') || mainFile?.code.includes('G700'),
          containsAbsolute: mainFile?.code.includes('G90'),
          containsEndProgram: mainFile?.code.includes('M30'),
        });
      }

      // All files should have consistent structure
      results.forEach((result) => {
        expect(result.hasMainFile).toBe(true);
        expect(result.containsUnits).toBe(true);
        expect(result.containsAbsolute).toBe(true);
        expect(result.containsEndProgram).toBe(true);
      });
    }, 15_000);
  });
});
