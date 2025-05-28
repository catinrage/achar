import { describe, it, expect, beforeEach } from 'vitest';
import { Machine } from '../../src/lib/machine';
import { DirectionEnum } from '../../src/common/enums';

describe('Wrapper', () => {
  let wrapper: Machine['position']['x'];

  beforeEach(() => {
    wrapper = new Machine().position.x;
  });

  it('should initialize with null value', () => {
    expect(wrapper.value).toBeNull();
  });

  it('should render empty string for undefined value', () => {
    expect(wrapper.render(undefined)).toBe('');
  });

  it('should render value with prefix', () => {
    expect(wrapper.render(10)).toBe('X10');
  });

  it('should not render if value is same and not forced', () => {
    wrapper.render(10);
    expect(wrapper.render(10)).toBe('');
  });

  it('should render if value is same but forced', () => {
    wrapper.render(10);
    expect(wrapper.render(10, true)).toBe('X10');
  });

  it('should transform value if transform function provided', () => {
    const customWrapper = new Machine()['position'].x;
    customWrapper['_transform'] = (v) => v.toFixed(2);
    expect(customWrapper.render(10.123)).toBe('X10.12');
  });
});

describe('Machine', () => {
  let machine: Machine;

  beforeEach(() => {
    machine = new Machine();
  });

  describe('position', () => {
    it('should have all axis wrappers', () => {
      expect(machine.position).toHaveProperty('x');
      expect(machine.position).toHaveProperty('y');
      expect(machine.position).toHaveProperty('z');
      expect(machine.position).toHaveProperty('a');
      expect(machine.position).toHaveProperty('b');
      expect(machine.position).toHaveProperty('c');
    });

    it('should set position and return G-code', () => {
      const result = machine.setPosition({ x: 10, y: 20, z: 30 });
      expect(result).toBe('X10 Y20 Z30');
    });

    it('should only include changed axes', () => {
      machine.setPosition({ x: 10, y: 20 });
      const result = machine.setPosition({ x: 20, z: 30 });
      expect(result).toBe('X20 Z30');
    });

    it('should force print all axes', () => {
      machine.setPosition({ x: 10, y: 20 });
      const result = machine.setPosition({ x: 10, y: 20 }, true);
      expect(result).toBe('X10 Y20');
    });
  });

  describe('motionMode', () => {
    it('should set G0 (rapid) mode', () => {
      const result = machine.setMotionMode(0);
      expect(result).toBe('G0');
    });

    it('should set G1 (linear) mode', () => {
      const result = machine.setMotionMode(1);
      expect(result).toBe('G1');
    });

    it('should not repeat same mode', () => {
      machine.setMotionMode(0);
      const result = machine.setMotionMode(0);
      expect(result).toBe('');
    });

    it('should force print mode', () => {
      machine.setMotionMode(0);
      const result = machine.setMotionMode(0, true);
      expect(result).toBe('G0');
    });
  });

  describe('homeNumber', () => {
    it('should set home number', () => {
      const result = machine.setHomeNumber(28);
      expect(result).toBe('G28');
    });

    it('should not repeat same home number', () => {
      machine.setHomeNumber(28);
      const result = machine.setHomeNumber(28);
      expect(result).toBe('');
    });

    it('should force print home number', () => {
      machine.setHomeNumber(28);
      const result = machine.setHomeNumber(28, true);
      expect(result).toBe('G28');
    });
  });

  describe('feedRate', () => {
    it('should set feed rate', () => {
      const result = machine.setFeedRate(500);
      expect(result).toBe('F500');
    });

    it('should not repeat same feed rate', () => {
      machine.setFeedRate(500);
      const result = machine.setFeedRate(500);
      expect(result).toBe('');
    });

    it('should force print feed rate', () => {
      machine.setFeedRate(500);
      const result = machine.setFeedRate(500, true);
      expect(result).toBe('F500');
    });
  });

  describe('spindleSpeed', () => {
    it('should set spindle speed', () => {
      const result = machine.setSpindleSpeed(1200);
      expect(result).toBe('S1200');
    });

    it('should not repeat same spindle speed', () => {
      machine.setSpindleSpeed(1200);
      const result = machine.setSpindleSpeed(1200);
      expect(result).toBe('');
    });

    it('should force print spindle speed', () => {
      machine.setSpindleSpeed(1200);
      const result = machine.setSpindleSpeed(1200, true);
      expect(result).toBe('S1200');
    });
  });

  describe('spindleDirection', () => {
    it('should set CW direction (M3)', () => {
      const result = machine.setSpindleDirection(DirectionEnum.CW);
      expect(result).toBe('M3');
    });

    it('should set CCW direction (M4)', () => {
      const result = machine.setSpindleDirection(DirectionEnum.CCW);
      expect(result).toBe('M4');
    });

    it('should not repeat same direction', () => {
      machine.setSpindleDirection(DirectionEnum.CW);
      const result = machine.setSpindleDirection(DirectionEnum.CW);
      expect(result).toBe('');
    });

    it('should force print direction', () => {
      machine.setSpindleDirection(DirectionEnum.CW);
      const result = machine.setSpindleDirection(DirectionEnum.CW, true);
      expect(result).toBe('M3');
    });
  });
});
