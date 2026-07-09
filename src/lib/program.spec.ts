import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventData } from './parser';
import { Program } from './program';

describe('Program', () => {
  let program: Program;

  beforeEach(() => {
    program = new Program();
  });

  describe('Constructor', () => {
    it('should initialize with default options', () => {
      expect(program).toBeDefined();
      expect(program.listEvents()).toEqual([]);
    });

    it('should accept custom options', () => {
      const customProgram = new Program({
        programName: 'TestProgram',
        numbering: {
          enabled: false,
          start: 100,
          increment: 5,
        },
      });
      expect(customProgram).toBeDefined();
    });
  });

  describe('loadEvents', () => {
    it('should load events from parsed data', () => {
      const mockEvents: EventData[] = [
        {
          _eventName: 'StartOfFile',
          _index: 0,
          program_number: 1000,
        },
        {
          _eventName: 'ToolChange',
          _index: 1,
          tool_number: 1,
          tool_spin: 1000,
        },
        {
          _eventName: 'EndOfFile',
          _index: 2,
        },
      ];

      program.loadEvents(mockEvents);
      const eventNames = program.listEvents();

      expect(eventNames).toEqual(['StartOfFile', 'ToolChange', 'EndOfFile']);
    });

    it('should handle empty event array', () => {
      program.loadEvents([]);
      expect(program.listEvents()).toEqual([]);
    });
  });

  describe('Event Listeners', () => {
    it('should register event listeners', () => {
      const mockHandler = vi.fn();
      program.on('StartOfFile', mockHandler);

      // We can't directly test the internal state, but we can test by triggering
      program.trigger(
        'StartOfFile',
        { program_number: 1000 },
        {
          index: 0,
          eventCallCounter: 0,
          currentFile: () => {
            throw new Error('currentFile not used');
          },
          next: null,
          previous: null,
          findLastEvent: vi.fn(),
          findNearestEvent: vi.fn(),
          findNthNextEvent: vi.fn(),
          findNthPreviousEvent: vi.fn(),
          findLastEventOrThrow: vi.fn(),
          findNearestEventOrThrow: vi.fn(),
          findNthNextEventOrThrow: vi.fn(),
          findNthPreviousEventOrThrow: vi.fn(),
        },
      );

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should register multiple listeners for the same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      program.on('StartOfFile', handler1);
      program.on('StartOfFile', handler2);

      program.trigger(
        'StartOfFile',
        { program_number: 1000 },
        {
          index: 0,
          eventCallCounter: 0,
          currentFile: () => {
            throw new Error('currentFile not used');
          },
          next: null,
          previous: null,
          findLastEvent: vi.fn(),
          findNearestEvent: vi.fn(),
          findNthNextEvent: vi.fn(),
          findNthPreviousEvent: vi.fn(),
          findLastEventOrThrow: vi.fn(),
          findNearestEventOrThrow: vi.fn(),
          findNthNextEventOrThrow: vi.fn(),
          findNthPreviousEventOrThrow: vi.fn(),
        },
      );

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should remove event listeners', () => {
      const mockHandler = vi.fn();
      program.on('StartOfFile', mockHandler);
      program.off('StartOfFile', mockHandler);

      program.trigger(
        'StartOfFile',
        { program_number: 1000 },
        {
          index: 0,
          eventCallCounter: 0,
          currentFile: () => {
            throw new Error('currentFile not used');
          },
          next: null,
          previous: null,
          findLastEvent: vi.fn(),
          findNearestEvent: vi.fn(),
          findNthNextEvent: vi.fn(),
          findNthPreviousEvent: vi.fn(),
          findLastEventOrThrow: vi.fn(),
          findNearestEventOrThrow: vi.fn(),
          findNthNextEventOrThrow: vi.fn(),
          findNthPreviousEventOrThrow: vi.fn(),
        },
      );

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('trigger', () => {
    it('should call registered listeners with correct parameters', () => {
      const mockHandler = vi.fn();
      program.on('ToolChange', mockHandler);

      const params = { tool_number: 5, tool_spin: 2000 };
      const metadata = {
        index: 1,
        eventCallCounter: 0,
        currentFile: () => {
          throw new Error('currentFile not used');
        },
        next: null,
        previous: null,
        findLastEvent: vi.fn(),
        findNearestEvent: vi.fn(),
        findNthNextEvent: vi.fn(),
        findNthPreviousEvent: vi.fn(),
        findLastEventOrThrow: vi.fn(),
        findNearestEventOrThrow: vi.fn(),
        findNthNextEventOrThrow: vi.fn(),
        findNthPreviousEventOrThrow: vi.fn(),
      };

      program.trigger('ToolChange', params, metadata);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.any(Object), // Builder instance
        params,
        metadata,
      );
    });

    it('should not call listeners for other events', () => {
      const startHandler = vi.fn();
      const toolHandler = vi.fn();

      program.on('StartOfFile', startHandler);
      program.on('ToolChange', toolHandler);

      program.trigger(
        'StartOfFile',
        { program_number: 1000 },
        {
          index: 0,
          eventCallCounter: 0,
          currentFile: () => {
            throw new Error('currentFile not used');
          },
          next: null,
          previous: null,
          findLastEvent: vi.fn(),
          findNearestEvent: vi.fn(),
          findNthNextEvent: vi.fn(),
          findNthPreviousEvent: vi.fn(),
          findLastEventOrThrow: vi.fn(),
          findNearestEventOrThrow: vi.fn(),
          findNthNextEventOrThrow: vi.fn(),
          findNthPreviousEventOrThrow: vi.fn(),
        },
      );

      expect(startHandler).toHaveBeenCalledTimes(1);
      expect(toolHandler).not.toHaveBeenCalled();
    });
  });

  describe('process', () => {
    it('should process all loaded events in order', () => {
      const startHandler = vi.fn();
      const toolHandler = vi.fn();
      const endHandler = vi.fn();

      program.on('StartOfFile', startHandler);
      program.on('ToolChange', toolHandler);
      program.on('EndOfFile', endHandler);

      const mockEvents: EventData[] = [
        {
          _eventName: 'StartOfFile',
          _index: 0,
          program_number: 1000,
        },
        {
          _eventName: 'ToolChange',
          _index: 1,
          tool_number: 1,
          tool_spin: 1000,
        },
        {
          _eventName: 'EndOfFile',
          _index: 2,
        },
      ];

      program.loadEvents(mockEvents);
      program.process();

      expect(startHandler).toHaveBeenCalledTimes(1);
      expect(toolHandler).toHaveBeenCalledTimes(1);
      expect(endHandler).toHaveBeenCalledTimes(1);
    });

    it('should provide correct metadata to event listeners', () => {
      const handler = vi.fn();
      program.on('ToolChange', handler);

      const mockEvents: EventData[] = [
        {
          _eventName: 'StartOfFile',
          _index: 0,
          program_number: 1000,
        },
        {
          _eventName: 'ToolChange',
          _index: 1,
          tool_number: 1,
          tool_spin: 1000,
        },
        {
          _eventName: 'EndOfFile',
          _index: 2,
        },
      ];

      program.loadEvents(mockEvents);
      program.process();

      const call = handler.mock.calls[0];
      const metadata = call[2];

      expect(metadata.index).toBe(1);
      expect(metadata.previous).toBeDefined();
      expect(metadata.previous?.name).toBe('StartOfFile');
      expect(metadata.next).toBeDefined();
      expect(metadata.next?.name).toBe('EndOfFile');
    });

    it('should handle events with no registered listeners', () => {
      const mockEvents: EventData[] = [
        {
          _eventName: 'StartOfFile',
          _index: 0,
          program_number: 1000,
        },
      ];

      program.loadEvents(mockEvents);

      // Should not throw when processing events with no listeners
      expect(() => program.process()).not.toThrow();
    });
  });

  describe('generate', () => {
    it('should return G-code generated by event handlers', () => {
      program.on('StartOfFile', (builder, params) => {
        builder.put('%');
        builder.put(`O${params.program_number || 1000}`);
      });

      program.on('EndOfFile', (builder) => {
        builder.put('M30');
        builder.put('%');
      });

      const mockEvents: EventData[] = [
        {
          _eventName: 'StartOfFile',
          _index: 0,
          program_number: 1234,
        },
        {
          _eventName: 'EndOfFile',
          _index: 1,
        },
      ];

      program.loadEvents(mockEvents);
      program.process();
      const result = program.generate();

      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('file');
      expect(result[0]).toHaveProperty('code');
      expect(result[0].code).toContain('O1234');
      expect(result[0].code).toContain('M30');
    });

    it('should handle empty programs', () => {
      const result = program.generate();
      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(Array);
    });
  });

  describe('Integration Test', () => {
    it('should process a complete program flow', () => {
      // Set up event handlers
      program.on('StartOfFile', (builder, params) => {
        builder.put('%');
        builder.put(`O${params.program_number || 1000}`);
      });

      program.on('ToolChange', (builder, params) => {
        builder.SelectTool(`T${params.tool_number}`);
        builder.ChangeTool();
        builder.SetSpindleSpeed(params.tool_spin);
      });

      program.on('RapidMove', (builder, params) => {
        builder.Rapid({
          x: params.xpos,
          y: params.ypos,
          z: params.zpos,
        });
      });

      program.on('Line', (builder, params) => {
        builder.Line({
          x: params.xpos,
          y: params.ypos,
          z: params.zpos,
        });
      });

      program.on('EndOfFile', (builder) => {
        builder.put('M30');
        builder.put('%');
      });

      // Load events
      const mockEvents: EventData[] = [
        {
          _eventName: 'StartOfFile',
          _index: 0,
          program_number: 2000,
        },
        {
          _eventName: 'ToolChange',
          _index: 1,
          tool_number: 1,
          tool_spin: 1500,
        },
        {
          _eventName: 'RapidMove',
          _index: 2,
          xpos: 10,
          ypos: 20,
          zpos: 5,
        },
        {
          _eventName: 'Line',
          _index: 3,
          xpos: 30,
          ypos: 40,
          zpos: -2,
        },
        {
          _eventName: 'EndOfFile',
          _index: 4,
        },
      ];

      program.loadEvents(mockEvents);
      program.process();
      const result = program.generate();

      expect(result[0].code).toContain('O2000');
      expect(result[0].code).toContain('T="T1"');
      expect(result[0].code).toContain('M6');
      expect(result[0].code).toContain('S1500');
      expect(result[0].code).toContain('G0');
      expect(result[0].code).toContain('G1');
      expect(result[0].code).toContain('M30');
    });
  });
});
