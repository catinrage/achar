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

    it('should preserve signed zero on linear axes', () => {
      expect(machine.setPosition({ x: -0, y: -0, z: -0 })).toBe('X-0 Y-0 Z-0');
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

  describe('modal state transitions', () => {
    it('re-emits a modal word after the value changes back', () => {
      expect(machine.setMachinePlane(PlaneEnum.XY)).toBe('G17');
      expect(machine.setMachinePlane(PlaneEnum.XZ)).toBe('G18');
      expect(machine.setMachinePlane(PlaneEnum.XY)).toBe('G17');
    });

    it('tracks motion mode changes without repeating unchanged modes', () => {
      expect(machine.setMotionMode(0)).toBe('G0');
      expect(machine.setMotionMode(0)).toBe('');
      expect(machine.setMotionMode(1)).toBe('G1');
      expect(machine.setMotionMode(1)).toBe('');
      expect(machine.setMotionMode(0)).toBe('G0');
    });

    it('deduplicates positioning mode, unit system, feed-rate mode, and home', () => {
      expect(machine.setPositioningMode(90)).toBe('G90');
      expect(machine.setPositioningMode(90)).toBe('');
      expect(machine.setPositioningMode(91)).toBe('G91');

      expect(machine.setUnitSystem(710)).toBe('G710');
      expect(machine.setUnitSystem(710)).toBe('');
      expect(machine.setUnitSystem(700)).toBe('G700');

      expect(machine.setFeedRateMode(94)).toBe('G94');
      expect(machine.setFeedRateMode(94)).toBe('');
      expect(machine.setFeedRateMode(95)).toBe('G95');

      expect(machine.setHomeNumber(54)).toBe('G54');
      expect(machine.setHomeNumber(54)).toBe('');
      expect(machine.setHomeNumber(55)).toBe('G55');
    });

    it('switches spindle direction and suppresses repeats', () => {
      expect(machine.setSpindleDirection(DirectionEnum.CW)).toBe('M3');
      expect(machine.setSpindleDirection(DirectionEnum.CW)).toBe('');
      expect(machine.setSpindleDirection(DirectionEnum.CCW)).toBe('M4');
      expect(machine.setSpindleDirection(DirectionEnum.CW)).toBe('M3');
    });

    it('supports forcePrint on every modal setter', () => {
      machine.setMachinePlane(PlaneEnum.XY);
      machine.setMotionMode(1);
      machine.setPositioningMode(90);
      machine.setUnitSystem(710);
      machine.setFeedRateMode(94);
      machine.setHomeNumber(54);

      expect(machine.setMachinePlane(PlaneEnum.XY, true)).toBe('G17');
      expect(machine.setMotionMode(1, true)).toBe('G1');
      expect(machine.setPositioningMode(90, true)).toBe('G90');
      expect(machine.setUnitSystem(710, true)).toBe('G710');
      expect(machine.setFeedRateMode(94, true)).toBe('G94');
      expect(machine.setHomeNumber(54, true)).toBe('G54');
    });
  });

  describe('rotary axis formatting', () => {
    it('appends a trailing dot to integer rotary values only', () => {
      expect(machine.setPosition({ a: 90 })).toBe('A90.');
      expect(machine.setPosition({ a: 61.915 })).toBe('A61.915');
      expect(machine.setPosition({ b: -24 })).toBe('B-24.');
      expect(machine.setPosition({ c: -165.25 })).toBe('C-165.25');
    });

    it('deduplicates rotary values independently of linear axes', () => {
      machine.setPosition({ x: 10, a: 90 });
      expect(machine.setPosition({ x: 10, a: 90 })).toBe('');
      expect(machine.setPosition({ x: 20, a: 90 })).toBe('X20');
      expect(machine.setPosition({ x: 20, a: 45 })).toBe('A45.');
    });
  });

  describe('input validation', () => {
    it('rejects non-finite and negative feed rates', () => {
      expect(() => machine.setFeedRate(Number.NaN)).toThrow(/finite/);
      expect(() =>
        machine.setFeedRate(Number.POSITIVE_INFINITY),
      ).toThrow(/finite/);
      expect(() => machine.setFeedRate(-100)).toThrow(/negative/);
      expect(() => machine.setFeedRate(50001)).toThrow(/maximum/);
    });

    it('rejects non-finite and negative spindle speeds', () => {
      expect(() => machine.setSpindleSpeed(Number.NaN)).toThrow(/finite/);
      expect(() => machine.setSpindleSpeed(-1)).toThrow(/negative/);
      expect(() => machine.setSpindleSpeed(50001)).toThrow(/maximum/);
    });

    it('rejects invalid tool names and accepts Siemens-style names', () => {
      expect(() => machine.selectTool('')).toThrow(/empty/);
      expect(() => machine.selectTool('T1"; M30')).toThrow(/safe/);
      expect(machine.selectTool('TAPG1/4')).toBe('T="TAPG1/4"');
      expect(machine.selectTool('BN8Z2_U-1.5')).toBe('T="BN8Z2_U-1.5"');
    });

    it('rejects non-finite coordinates', () => {
      expect(() => machine.setPosition({ x: Number.NaN })).toThrow(/finite/);
      expect(() =>
        machine.setPosition({ z: Number.NEGATIVE_INFINITY }),
      ).toThrow(/finite/);
    });

    it('skips bounds validation when validateBounds is disabled', () => {
      const permissive = new Machine(mockBuilder, { validateBounds: false });
      expect(permissive.setFeedRate(-100)).toBe('F-100');
      expect(permissive.setSpindleSpeed(60000)).toBe('S60000');
    });
  });
});

describe('Emitter', () => {
  it('returns empty output for undefined values without touching state', () => {
    const emitter = new Emitter<number>('F');
    expect(emitter.render(null, 0, undefined, undefined)).toBe('');
    expect(emitter.value).toBeNull();
  });

  it('emits only on change and tracks the current value', () => {
    const emitter = new Emitter<number>('F');
    expect(emitter.render(null, 0, 500, undefined)).toBe('F500');
    expect(emitter.render(null, 0, 500, undefined)).toBe('');
    expect(emitter.value).toBe(500);
    expect(emitter.render(null, 0, 600, undefined)).toBe('F600');
    expect(emitter.value).toBe(600);
  });

  it('honors forcePrint for unchanged values', () => {
    const emitter = new Emitter<number>('S');
    emitter.render(null, 0, 3000, undefined);
    expect(emitter.render(null, 0, 3000, true)).toBe('S3000');
  });

  it('applies the transform when rendering', () => {
    const emitter = new Emitter<number>('A', (value) =>
      Number.isInteger(value) ? `${value}.` : value.toString(),
    );
    expect(emitter.render(null, 0, 90, undefined)).toBe('A90.');
    expect(emitter.render(null, 0, 45.5, undefined)).toBe('A45.5');
  });
});
