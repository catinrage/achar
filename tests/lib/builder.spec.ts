import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Builder } from '../../src/lib/builder';
import { DirectionEnum } from '../../src/common/enums';
import { Machine } from '../../src/lib/machine';

describe('Builder', () => {
  let builder: Builder;

  beforeEach(() => {
    builder = new Builder();
  });

  describe('constructor', () => {
    it('should initialize with empty lines and currentLine', () => {
      expect(builder.gcode).toBe('');
      expect(builder['_lines']).toEqual([]);
      expect(builder['_currentLine']).toEqual([]);
    });

    it('should initialize with a Machine instance', () => {
      expect(builder['_machine']).toBeInstanceOf(Machine);
    });

    it('should start with line number 10', () => {
      expect(builder['_lineNumber']).toBe(10);
    });
  });

  describe('put', () => {
    it('should add non-empty sections to current line', () => {
      builder.put('G0');
      builder.put('X10');
      expect(builder['_currentLine']).toEqual(['G0', 'X10']);
    });

    it('should ignore empty sections', () => {
      builder.put('');
      builder.put('   ');
      expect(builder['_currentLine']).toEqual([]);
    });
  });

  describe('flush', () => {
    it('should not flush empty current line', () => {
      builder.flush();
      expect(builder['_lines']).toEqual([]);
    });

    it('should flush current line with line number', () => {
      builder.put('G0');
      builder.put('X10');
      builder.flush();
      expect(builder['_lines']).toEqual(['N10 G0 X10']);
    });

    it('should increment line number by 10', () => {
      builder.put('G0');
      builder.flush();
      expect(builder['_lineNumber']).toBe(20);
    });

    it('should clear current line after flush', () => {
      builder.put('G0');
      builder.flush();
      expect(builder['_currentLine']).toEqual([]);
    });
  });

  describe('gcode property', () => {
    it('should return empty string when no lines', () => {
      expect(builder.gcode).toBe('');
    });

    it('should join lines with newline characters', () => {
      builder.put('G0');
      builder.flush();
      builder.put('G1');
      builder.flush();
      expect(builder.gcode).toBe('N10 G0\nN20 G1');
    });
  });

  describe('Rapid command', () => {
    it('should generate G0 and position commands', () => {
      builder.Rapid({ x: 10, y: 20 });
      expect(builder['_lines']).toEqual(['N10 G0 X10 Y20']);
    });

    it('should not flush when noFlush option is true', () => {
      builder.Rapid({ x: 10 }, { noFlush: true });
      expect(builder['_lines']).toEqual([]);
      expect(builder['_currentLine']).toEqual(['G0', 'X10']);
    });

    it('should force print when forcePrint option is true', () => {
      const machine = builder['_machine'];
      vi.spyOn(machine, 'setMotionMode');
      vi.spyOn(machine, 'setPosition');

      builder.Rapid({ x: 10 }, { forcePrint: true });
      expect(machine.setMotionMode).toHaveBeenCalledWith(0, true);
      expect(machine.setPosition).toHaveBeenCalledWith({ x: 10 }, true);
    });
  });

  describe('Line command', () => {
    it('should generate G1 and position commands', () => {
      builder.Line({ x: 10, y: 20 });
      expect(builder['_lines']).toEqual(['N10 G1 X10 Y20']);
    });

    it('should not flush when noFlush option is true', () => {
      builder.Line({ x: 10 }, { noFlush: true });
      expect(builder['_lines']).toEqual([]);
      expect(builder['_currentLine']).toEqual(['G1', 'X10']);
    });

    it('should force print when forcePrint option is true', () => {
      const machine = builder['_machine'];
      vi.spyOn(machine, 'setMotionMode');
      vi.spyOn(machine, 'setPosition');

      builder.Line({ x: 10 }, { forcePrint: true });
      expect(machine.setMotionMode).toHaveBeenCalledWith(1, true);
      expect(machine.setPosition).toHaveBeenCalledWith({ x: 10 }, true);
    });
  });

  describe('SetSpindleSpeed command', () => {
    it('should generate S command', () => {
      builder.SetSpindleSpeed(1200);
      expect(builder['_lines']).toEqual(['N10 S1200']);
    });

    it('should not flush when noFlush option is true', () => {
      builder.SetSpindleSpeed(1200, { noFlush: true });
      expect(builder['_lines']).toEqual([]);
      expect(builder['_currentLine']).toEqual(['S1200']);
    });

    it('should force print when forcePrint option is true', () => {
      const machine = builder['_machine'];
      vi.spyOn(machine, 'setSpindleSpeed');

      builder.SetSpindleSpeed(1200, { forcePrint: true });
      expect(machine.setSpindleSpeed).toHaveBeenCalledWith(1200, true);
    });
  });

  describe('SetSpindleDirection command', () => {
    it('should generate M3 for CW direction', () => {
      builder.SetSpindleDirection(DirectionEnum.CW);
      expect(builder['_lines']).toEqual(['N10 M3']);
    });

    it('should generate M4 for CCW direction', () => {
      builder.SetSpindleDirection(DirectionEnum.CCW);
      expect(builder['_lines']).toEqual(['N10 M4']);
    });

    it('should not flush when noFlush option is true', () => {
      builder.SetSpindleDirection(DirectionEnum.CW, { noFlush: true });
      expect(builder['_lines']).toEqual([]);
      expect(builder['_currentLine']).toEqual(['M3']);
    });

    it('should force print when forcePrint option is true', () => {
      const machine = builder['_machine'];
      vi.spyOn(machine, 'setSpindleDirection');

      builder.SetSpindleDirection(DirectionEnum.CW, { forcePrint: true });
      expect(machine.setSpindleDirection).toHaveBeenCalledWith(DirectionEnum.CW, true);
    });
  });
});
