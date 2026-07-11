import { describe, expect, it } from 'bun:test';
import type { EventData } from './parser';
import { Program } from './program';

describe('Program ...OrThrow methods', () => {
  it('should throw when findLastEventOrThrow fails', () => {
    const program = new Program({ programName: 'Test' });
    const events = [
      { _eventName: 'StartOfFile', _index: 0, inch_system: true }, // 0
      {
        _eventName: 'ToolChange',
        _index: 1,
        tool_number: 1,
        tool_id_string: 'T1',
      }, // 1
      { _eventName: 'Line', _index: 2, xpos: 10 }, // 2
    ];
    program.loadEvents(events as EventData[]);

    let called = false;
    program.on('Line', (_$, _params, metadata) => {
      called = true;
      // Should find ToolChange
      const result = metadata.findLastEventOrThrow('ToolChange');
      expect(result).toBeDefined();
      expect(result.name).toBe('ToolChange');

      // Should throw for missing event
      expect(() => metadata.findLastEventOrThrow('StartOfJob')).toThrow();
    });

    program.process();
    expect(called).toBe(true);
  });

  it('should throw when findNearestEventOrThrow fails', () => {
    const program = new Program({ programName: 'Test' });
    const events = [
      { _eventName: 'Line', _index: 0, xpos: 10 }, // 0
      {
        _eventName: 'ToolChange',
        _index: 1,
        tool_number: 1,
        tool_id_string: 'T1',
      }, // 1
    ];
    program.loadEvents(events as EventData[]);

    let called = false;
    program.on('Line', (_$, _params, metadata) => {
      called = true;
      // Should find ToolChange
      const result = metadata.findNearestEventOrThrow('ToolChange');
      expect(result).toBeDefined();
      expect(result.name).toBe('ToolChange');

      // Should throw for missing event
      expect(() => metadata.findNearestEventOrThrow('StartOfJob')).toThrow();
    });

    program.process();
    expect(called).toBe(true);
  });

  it('should throw when findNthNextEventOrThrow fails', () => {
    const program = new Program({ programName: 'Test' });
    const events = [
      { _eventName: 'Line', _index: 0, xpos: 10 }, // 0
      {
        _eventName: 'ToolChange',
        _index: 1,
        tool_number: 1,
        tool_id_string: 'T1',
      }, // 1
      {
        _eventName: 'ToolChange',
        _index: 2,
        tool_number: 2,
        tool_id_string: 'T2',
      }, // 2
    ];
    program.loadEvents(events as EventData[]);

    let called = false;
    program.on('Line', (_$, _params, metadata) => {
      called = true;
      // Should find 2nd ToolChange
      const result = metadata.findNthNextEventOrThrow('ToolChange', 2);
      expect(result).toBeDefined();
      expect(result.data.tool_number).toBe(2);

      // Should throw for 3rd ToolChange
      expect(() => metadata.findNthNextEventOrThrow('ToolChange', 3)).toThrow();
    });

    program.process();
    expect(called).toBe(true);
  });

  it('should throw when findNthPreviousEventOrThrow fails', () => {
    const program = new Program({ programName: 'Test' });
    const events = [
      {
        _eventName: 'ToolChange',
        _index: 0,
        tool_number: 1,
        tool_id_string: 'T1',
      }, // 0
      {
        _eventName: 'ToolChange',
        _index: 1,
        tool_number: 2,
        tool_id_string: 'T2',
      }, // 1
      { _eventName: 'Line', _index: 2, xpos: 10 }, // 2
    ];
    program.loadEvents(events as EventData[]);

    let called = false;
    program.on('Line', (_$, _params, metadata) => {
      called = true;
      // Should find 2nd previous ToolChange (which is at index 0)
      const result = metadata.findNthPreviousEventOrThrow('ToolChange', 2);
      expect(result).toBeDefined();
      expect(result.data.tool_number).toBe(1);

      // Should throw for 3rd ToolChange
      expect(() =>
        metadata.findNthPreviousEventOrThrow('ToolChange', 3),
      ).toThrow();
    });

    program.process();
    expect(called).toBe(true);
  });
});
