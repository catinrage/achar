import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventsType } from '../types';
import { Emitter } from './emitter';
import type { Event } from './event';

describe('Emitter', () => {
  let emitter: Emitter<number>;
  let mockEvent: Event<keyof EventsType>;

  beforeEach(() => {
    mockEvent = {
      name: 'TestEvent',
      data: {},
      trigger: vi.fn(),
    } as unknown as Event<keyof EventsType>;
    emitter = new Emitter<number>('X');
  });

  describe('Constructor', () => {
    it('should initialize with correct prefix', () => {
      const xEmitter = new Emitter<number>('X');
      expect(xEmitter.value).toBeNull();
    });

    it('should accept transform function', () => {
      const transformEmitter = new Emitter<string>(
        'T',
        (value) => `="${value}"`,
      );
      const result = transformEmitter.render(mockEvent, 0, 'MyTool', false);
      expect(result).toBe('T="MyTool"');
    });
  });

  describe('render', () => {
    it('should render value when first set', () => {
      const result = emitter.render(mockEvent, 0, 10, false);
      expect(result).toBe('X10');
      expect(emitter.value).toBe(10);
    });

    it('should not render same value twice', () => {
      emitter.render(mockEvent, 0, 10, false);
      const result = emitter.render(mockEvent, 0, 10, false);
      expect(result).toBe('');
      expect(emitter.value).toBe(10);
    });

    it('should render changed value', () => {
      emitter.render(mockEvent, 0, 10, false);
      const result = emitter.render(mockEvent, 0, 20, false);
      expect(result).toBe('X20');
      expect(emitter.value).toBe(20);
    });

    it('should force print when requested', () => {
      emitter.render(mockEvent, 0, 10, false);
      const result = emitter.render(mockEvent, 0, 10, true);
      expect(result).toBe('X10');
      expect(emitter.value).toBe(10);
    });

    it('should return empty string for undefined value', () => {
      const result = emitter.render(mockEvent, 0, undefined, false);
      expect(result).toBe('');
      expect(emitter.value).toBeNull();
    });

    it('should handle zero values correctly', () => {
      const result = emitter.render(mockEvent, 0, 0, false);
      expect(result).toBe('X0');
      expect(emitter.value).toBe(0);
    });

    it('should handle negative values', () => {
      const result = emitter.render(mockEvent, 0, -10, false);
      expect(result).toBe('X-10');
      expect(emitter.value).toBe(-10);
    });

    it('should handle floating point values', () => {
      const result = emitter.render(mockEvent, 0, 10.5, false);
      expect(result).toBe('X10.5');
      expect(emitter.value).toBe(10.5);
    });
  });

  describe('String Emitter', () => {
    let stringEmitter: Emitter<string>;

    beforeEach(() => {
      stringEmitter = new Emitter<string>('T');
    });

    it('should handle string values', () => {
      const result = stringEmitter.render(mockEvent, 0, 'tool1', false);
      expect(result).toBe('Ttool1');
      expect(stringEmitter.value).toBe('tool1');
    });

    it('should not render same string twice', () => {
      stringEmitter.render(mockEvent, 0, 'tool1', false);
      const result = stringEmitter.render(mockEvent, 0, 'tool1', false);
      expect(result).toBe('');
    });

    it('should handle empty strings', () => {
      const result = stringEmitter.render(mockEvent, 0, '', false);
      expect(result).toBe('T');
      expect(stringEmitter.value).toBe('');
    });
  });

  describe('Transform Function', () => {
    let transformEmitter: Emitter<string>;

    beforeEach(() => {
      transformEmitter = new Emitter<string>('T', (value) => `="${value}"`);
    });

    it('should apply transform function', () => {
      const result = transformEmitter.render(mockEvent, 0, 'MyTool', false);
      expect(result).toBe('T="MyTool"');
    });

    it('should apply transform with force print', () => {
      transformEmitter.render(mockEvent, 0, 'MyTool', false);
      const result = transformEmitter.render(mockEvent, 0, 'MyTool', true);
      expect(result).toBe('T="MyTool"');
    });

    it('should transform different values', () => {
      transformEmitter.render(mockEvent, 0, 'Tool1', false);
      const result = transformEmitter.render(mockEvent, 0, 'Tool2', false);
      expect(result).toBe('T="Tool2"');
    });
  });

  describe('Different G-code Prefixes', () => {
    it('should handle G-code prefixes', () => {
      const gEmitter = new Emitter<number>('G');
      const result = gEmitter.render(mockEvent, 0, 0, false);
      expect(result).toBe('G0');
    });

    it('should handle M-code prefixes', () => {
      const mEmitter = new Emitter<number>('M');
      const result = mEmitter.render(mockEvent, 0, 3, false);
      expect(result).toBe('M3');
    });

    it('should handle S-word prefixes', () => {
      const sEmitter = new Emitter<number>('S');
      const result = sEmitter.render(mockEvent, 0, 1500, false);
      expect(result).toBe('S1500');
    });

    it('should handle F-word prefixes', () => {
      const fEmitter = new Emitter<number>('F');
      const result = fEmitter.render(mockEvent, 0, 500, false);
      expect(result).toBe('F500');
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid value changes', () => {
      const values = [10, 20, 30, 20, 10];
      const results = values.map((val) =>
        emitter.render(mockEvent, 0, val, false),
      );

      expect(results[0]).toBe('X10'); // First value
      expect(results[1]).toBe('X20'); // Changed
      expect(results[2]).toBe('X30'); // Changed
      expect(results[3]).toBe('X20'); // Changed back
      expect(results[4]).toBe('X10'); // Changed back again
    });

    it('should handle alternating undefined and defined values', () => {
      let result = emitter.render(mockEvent, 0, 10, false);
      expect(result).toBe('X10');

      result = emitter.render(mockEvent, 0, undefined, false);
      expect(result).toBe('');

      result = emitter.render(mockEvent, 0, 20, false);
      expect(result).toBe('X20');
    });

    it('should maintain state across multiple renders', () => {
      emitter.render(mockEvent, 0, 10, false);
      emitter.render(mockEvent, 0, 20, false);
      emitter.render(mockEvent, 0, 30, false);

      expect(emitter.value).toBe(30);

      // Should not render same value
      const result = emitter.render(mockEvent, 0, 30, false);
      expect(result).toBe('');
    });
  });

  describe('Complex Transform Functions', () => {
    it('should handle complex number formatting', () => {
      const decimalEmitter = new Emitter<number>('X', (value) =>
        value.toFixed(3),
      );
      const result = decimalEmitter.render(mockEvent, 0, 10.1234, false);
      expect(result).toBe('X10.123');
    });

    it('should handle conditional transforms', () => {
      const conditionalEmitter = new Emitter<number>('G', (value) => {
        return value < 10 ? `0${value}` : `${value}`;
      });

      let result = conditionalEmitter.render(mockEvent, 0, 1, false);
      expect(result).toBe('G01');

      result = conditionalEmitter.render(mockEvent, 0, 17, false);
      expect(result).toBe('G17');
    });

    it('should handle string manipulation transforms', () => {
      const upperCaseEmitter = new Emitter<string>('T', (value) =>
        value.toUpperCase(),
      );
      const result = upperCaseEmitter.render(mockEvent, 0, 'tool1', false);
      expect(result).toBe('TTOOL1');
    });
  });
});
