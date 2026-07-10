import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectionEnum, PlaneEnum } from '../common/enums';
import type { Builder } from './builder';
import { Emitter } from './emitter';
import { Machine } from './machine';

// Mock the Builder class
const mockBuilder = {
  currentEvent: { _index: 0, _eventName: 'TestEvent' },
  currentEventListenerIndex: 0,
} as unknown as Builder;

describe('Machine', () => {
  let machine: Machine;

  beforeEach(() => {
    // Reset emitters before each test
    vi.spyOn(Emitter.prototype, 'render').mockClear();
    machine = new Machine(mockBuilder);
  });

  it('should initialize with default values', () => {
    // This is tricky to test without exposing private properties.
    // We'll infer state by calling methods with undefined and checking the output.
    const pos = machine.setPosition({});
    expect(pos).toBe('');
  });

  describe('setPosition', () => {
    it('should update position and return G-code for changed axes', () => {
      const pos = machine.setPosition({ x: 10, y: 20 });
      expect(pos).toBe('X10 Y20');
    });

    it('should not output G-code for unchanged axes', () => {
      machine.setPosition({ x: 10, y: 20 });
      const pos2 = machine.setPosition({ x: 10, y: 30 });
      expect(pos2).toBe('Y30');
    });

    it('should force print all axes when forcePrint is true', () => {
      machine.setPosition({ x: 10, y: 20 });
      const pos2 = machine.setPosition({ x: 10, y: 20 }, true);
      expect(pos2).toBe('X10 Y20');
    });

    it('should handle all axes', () => {
      const pos = machine.setPosition({ a: 1, b: 2, c: 3 });
      expect(pos).toBe('A1. B2. C3.');
    });
  });

  describe('setMachinePlane', () => {
    it('should set XY plane with G17', () => {
      const plane = machine.setMachinePlane(PlaneEnum.XY);
      expect(plane).toBe('G17');
    });

    it('should set XZ plane with G18', () => {
      const plane = machine.setMachinePlane(PlaneEnum.XZ);
      expect(plane).toBe('G18');
    });

    it('should set YZ plane with G19', () => {
      const plane = machine.setMachinePlane(PlaneEnum.YZ);
      expect(plane).toBe('G19');
    });

    it('should not repeat the same plane code', () => {
      machine.setMachinePlane(PlaneEnum.XY);
      const plane2 = machine.setMachinePlane(PlaneEnum.XY);
      expect(plane2).toBe('');
    });
  });

  describe('setMotionMode', () => {
    it('should set rapid motion with G0', () => {
      const mode = machine.setMotionMode(0);
      expect(mode).toBe('G0');
    });

    it('should set linear feed motion with G1', () => {
      const mode = machine.setMotionMode(1);
      expect(mode).toBe('G1');
    });
  });

  describe('setSpindleDirection', () => {
    it('should set CW direction with M3', () => {
      const spindle = machine.setSpindleDirection(DirectionEnum.CW);
      expect(spindle).toBe('M3');
    });

    it('should set CCW direction with M4', () => {
      const spindle = machine.setSpindleDirection(DirectionEnum.CCW);
      expect(spindle).toBe('M4');
    });

    it('should handle various CW enum values', () => {
      expect(machine.setSpindleDirection(DirectionEnum.CW)).toBe('M3');
      // Reset internal state for next check
      machine = new Machine(mockBuilder);
      expect(machine.setSpindleDirection(DirectionEnum.CWF)).toBe('M3');
      machine = new Machine(mockBuilder);
      expect(machine.setSpindleDirection(DirectionEnum.CWT)).toBe('M3');
    });
  });

  describe('Stateful G-Code Generation', () => {
    it('should only output a G-code word once for consecutive identical calls', () => {
      expect(machine.setFeedRate(500)).toBe('F500');
      expect(machine.setFeedRate(500)).toBe('');
      expect(machine.setFeedRate(600)).toBe('F600');
      expect(machine.setFeedRate(600)).toBe('');
    });

    it('should combine multiple different G-codes', () => {
      const motion = machine.setMotionMode(1); // G1
      const pos = machine.setPosition({ x: 100 }); // X100
      const feed = machine.setFeedRate(200); // F200

      // Note: the machine doesn't combine them in one string, the builder does.
      // Here we just check the individual outputs are correct.
      expect(motion).toBe('G1');
      expect(pos).toBe('X100');
      expect(feed).toBe('F200');
    });

    it('should allow forcing output of a value that has not changed', () => {
      expect(machine.setSpindleSpeed(3000)).toBe('S3000');
      expect(machine.setSpindleSpeed(3000)).toBe('');
      expect(machine.setSpindleSpeed(3000, true)).toBe('S3000');
    });
  });

  describe('selectTool', () => {
    it('should select a tool and format it correctly', () => {
      const tool = machine.selectTool('T1');
      expect(tool).toBe('T="T1"');
    });

    it('should not re-select the same tool', () => {
      machine.selectTool('T1');
      const tool2 = machine.selectTool('T1');
      expect(tool2).toBe('');
    });
  });

  // Testing other setters
  it('should set various machine properties correctly', () => {
    expect(machine.setUnitSystem(710)).toBe('G710');
    expect(machine.setPositioningMode(91)).toBe('G91');
    expect(machine.setFeedRateMode(95)).toBe('G95');
    expect(machine.setHomeNumber(54)).toBe('G54');
  });
});
