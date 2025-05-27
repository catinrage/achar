import { DirectionEnum } from '$src/common/enums';

/**
 * @class Wrapper
 * @template T - The type of the value being wrapped, typically string or number.
 * @description A utility class to wrap a machine parameter (like X-coordinate or spindle speed).
 * It only generates an output string (e.g., G-code segment) if the new value
 * is different from the current value, preventing redundant G-code.
 * It also handles prefixing the value (e.g., 'X' for X-coordinate).
 */
class Wrapper<T extends string | number> {
  private _value: T | null = null;
  private _prefix: string;
  private _transform?: (value: T) => string;

  /**
   * @constructor
   * @param {string} prefix - The G-code prefix for this parameter (e.g., 'X', 'G', 'M', 'S').
   * @param {(value: T) => string} [transform] - An optional function to transform the value before rendering.
   */
  constructor(prefix: string, transform?: (value: T) => string) {
    this._prefix = prefix;
    this._transform = transform;
  }

  /**
   * @method render
   * @description Renders the G-code string for this parameter if the newValue is different from the current value.
   * If newValue is undefined, it returns an empty string.
   * @param {T} [newValue] - The new value for the parameter.
   * @returns {string} The G-code string segment (e.g., "X100.0") or an empty string if the value hasn't changed or is undefined.
   */
  render(newValue?: T): string {
    if (newValue === undefined) {
      return '';
    }

    if (this._value === newValue) {
      return '';
    }
    this._value = newValue;
    return `${this._prefix}${
      this._transform ? this._transform(newValue) : newValue
    }`;
  }

  /**
   * @property {T | null} value
   * @description Gets the current value of the wrapped parameter.
   * @readonly
   */
  public get value(): T | null {
    return this._value;
  }
}

/**
 * @class Machine
 * @description Represents the state of a CNC machine. It tracks various parameters
 * like position, motion mode, feed rate, and spindle status.
 * Methods in this class are used to update the machine state and generate
 * corresponding G-code segments. It utilizes the Wrapper class to ensure
 * that G-code is only output for parameters that have changed.
 */
export class Machine {
  /**
   * @private
   * @property _position
   * @description Stores the machine's current coordinates (X, Y, Z, A, B, C).
   * Each axis is a Wrapper to manage its G-code output.
   */
  private _position: {
    x: Wrapper<number>;
    y: Wrapper<number>;
    z: Wrapper<number>;
    a: Wrapper<number>;
    b: Wrapper<number>;
    c: Wrapper<number>;
  } = {
    x: new Wrapper('X'),
    y: new Wrapper('Y'),
    z: new Wrapper('Z'),
    a: new Wrapper('A'),
    b: new Wrapper('B'),
    c: new Wrapper('C'),
  };

  /**
   * @private
   * @property _motionMode
   * @description Stores the current motion mode (e.g., G00 for rapid, G01 for linear).
   * Represented as a Wrapper for G-code generation.
   * 0 for G0 (Rapid), 1 for G1 (Linear Feed).
   */
  private _motionMode: Wrapper<0 | 1> = new Wrapper('G');
  /**
   * @private
   * @property _homeNumber
   * @description Stores the G-code for Homing (e.g. G28, G30).
   * This is usually a G-code like G28, G30 followed by axis letters or P for reference point number.
   * For simplicity here, it's just a number that will be prefixed with 'G'.
   */
  private _homeNumber: Wrapper<number> = new Wrapper('G');
  /**
   * @private
   * @property _feedRate
   * @description Stores the current feed rate (F-word).
   * Represented as a Wrapper for G-code generation.
   */
  private _feedRate: Wrapper<number> = new Wrapper('F');
  /**
   * @private
   * @property _spindleSpeed
   * @description Stores the current spindle speed (S-word).
   * Represented as a Wrapper for G-code generation.
   */
  private _spindleSpeed: Wrapper<number> = new Wrapper('S');
  /**
   * @private
   * @property _spindleDirection
   * @description Stores the current spindle direction (M-word for M03, M04).
   * Represented as a Wrapper for G-code generation.
   * 3 for M03 (Spindle ON Clockwise), 4 for M04 (Spindle ON Counter-Clockwise).
   */
  private _spindleDirection: Wrapper<3 | 4> = new Wrapper('M');

  /**
   * @method setPosition
   * @description Updates the machine's target position and returns the G-code string for the movement.
   * Only axes with new values will be included in the output.
   * @param value - An object containing new optional x, y, z, a, b, c coordinates.
   * @returns {string} The G-code string for the position change (e.g., "X10 Y20 Z5").
   */
  public setPosition(value: {
    x?: number;
    y?: number;
    z?: number;
    a?: number;
    b?: number;
    c?: number;
  }) {
    let output = '';
    output += this.position.x.render(value.x) + ' ';
    output += this.position.y.render(value.y) + ' ';
    output += this.position.z.render(value.z) + ' ';
    output += this.position.a.render(value.a) + ' ';
    output += this.position.b.render(value.b) + ' ';
    output += this.position.c.render(value.c) + ' ';
    output = output.replace(/\s+/g, ' ');
    return output.trim();
  }
  /**
   * @property position
   * @description Gets the current position wrappers.
   * @readonly
   */
  public get position() {
    return this._position;
  }

  /**
   * @method setMotionMode
   * @description Sets the machine's motion mode (e.g., G00, G01) and returns the G-code string.
   * @param {0 | 1} value - 0 for G0 (Rapid), 1 for G1 (Linear Feed).
   * @returns {string} The G-code string for the motion mode change (e.g., "G0", "G1").
   */
  public setMotionMode(value: 0 | 1) {
    let output = '';
    output += this.motionMode.render(value);
    return output.trim();
  }
  /**
   * @property motionMode
   * @description Gets the current motion mode wrapper.
   * @readonly
   */
  public get motionMode() {
    return this._motionMode;
  }

  /**
   * @method setHomeNumber
   * @description Sets the machine's home position/reference point number and returns the G-code string.
   * @param {number} value - The home number (e.g., 28 for G28).
   * @returns {string} The G-code string for the homing command (e.g., "G28").
   */
  public setHomeNumber(value: number) {
    let output = '';
    output += this._homeNumber.render(value);
    return output.trim();
  }
  /**
   * @property homeNumber
   * @description Gets the current home number wrapper.
   * @readonly
   */
  public get homeNumber() {
    return this._homeNumber;
  }

  /**
   * @method setFeedRate
   * @description Sets the machine's feed rate and returns the F-word G-code string.
   * @param {number} value - The new feed rate.
   * @returns {string} The G-code string for the feed rate change (e.g., "F500").
   */
  public setFeedRate(value: number) {
    let output = '';
    output += this._feedRate.render(value);
    return output.trim();
  }
  /**
   * @property feedRate
   * @description Gets the current feed rate wrapper.
   * @readonly
   */
  public get feedRate() {
    return this._feedRate;
  }

  /**
   * @method setSpindleSpeed
   * @description Sets the machine's spindle speed and returns the S-word G-code string.
   * @param {number} value - The new spindle speed.
   * @returns {string} The G-code string for the spindle speed change (e.g., "S1200").
   */
  public setSpindleSpeed(value: number) {
    let output = '';
    output += this._spindleSpeed.render(value);
    return output.trim();
  }
  /**
   * @property spindleSpeed
   * @description Gets the current spindle speed wrapper.
   * @readonly
   */
  public get spindleSpeed() {
    return this._spindleSpeed;
  }

  /**
   * @method setSpindleDirection
   * @description Sets the machine's spindle direction and returns the M-word G-code string.
   * @param {DirectionEnum} value - The spindle direction (CW or CCW).
   * @returns {string} The G-code string for the spindle direction (e.g., "M3", "M4").
   */
  public setSpindleDirection(value: DirectionEnum) {
    let output = '';
    output += this._spindleDirection.render(value === DirectionEnum.CW ? 3 : 4);
    return output.trim();
  }
  /**
   * @property spindleDirection
   * @description Gets the current spindle direction wrapper.
   * @readonly
   */
  public get spindleDirection() {
    return this._spindleDirection;
  }
}
