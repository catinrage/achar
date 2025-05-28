import { DirectionEnum } from '$src/common/enums';
import { Emitter } from './emitter';

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
    x: Emitter<number>;
    y: Emitter<number>;
    z: Emitter<number>;
    a: Emitter<number>;
    b: Emitter<number>;
    c: Emitter<number>;
  } = {
    x: new Emitter('X'),
    y: new Emitter('Y'),
    z: new Emitter('Z'),
    a: new Emitter('A'),
    b: new Emitter('B'),
    c: new Emitter('C'),
  };

  /**
   * @private
   * @property _motionMode
   * @description Stores the current motion mode (e.g., G00 for rapid, G01 for linear).
   * Represented as a Wrapper for G-code generation.
   * 0 for G0 (Rapid), 1 for G1 (Linear Feed).
   */
  private _motionMode: Emitter<0 | 1> = new Emitter('G');

  /**
   * @private
   * @property _homeNumber
   * @description Stores the G-code for Homing (e.g. G28, G30).
   * This is usually a G-code like G28, G30 followed by axis letters or P for reference point number.
   * For simplicity here, it's just a number that will be prefixed with 'G'.
   */
  private _homeNumber: Emitter<number> = new Emitter('G');

  /**
   * @private
   * @property _feedRate
   * @description Stores the current feed rate (F-word).
   * Represented as a Wrapper for G-code generation.
   */
  private _feedRate: Emitter<number> = new Emitter('F');

  /**
   * @private
   * @property _spindleSpeed
   * @description Stores the current spindle speed (S-word).
   * Represented as a Wrapper for G-code generation.
   */
  private _spindleSpeed: Emitter<number> = new Emitter('S');

  /**
   * @private
   * @property _spindleDirection
   * @description Stores the current spindle direction (M-word for M03, M04).
   * Represented as a Wrapper for G-code generation.
   * 3 for M03 (Spindle ON Clockwise), 4 for M04 (Spindle ON Counter-Clockwise).
   */
  private _spindleDirection: Emitter<3 | 4> = new Emitter('M');

  /**
   * @private
   * @property _tool
   * @description Stores the current tool (T-word).
   * Represented as a Wrapper for G-code generation.
   */
  private _tool: Emitter<string> = new Emitter('T', (value) => `="${value}"`);

  /**
   * @method setPosition
   * @description Updates the machine's target position and returns the G-code string for the movement.
   * Only axes with new values will be included in the output.
   * @param value - An object containing new optional x, y, z, a, b, c coordinates.
   * @param forcePrint - If true, prints the values even if they haven't changed.
   * @returns {string} The G-code string for the position change (e.g., "X10 Y20 Z5").
   */
  public setPosition(
    value: {
      x?: number;
      y?: number;
      z?: number;
      a?: number;
      b?: number;
      c?: number;
    },
    forcePrint?: boolean,
  ) {
    let output = '';
    output += this.position.x.render(value.x, forcePrint) + ' ';
    output += this.position.y.render(value.y, forcePrint) + ' ';
    output += this.position.z.render(value.z, forcePrint) + ' ';
    output += this.position.a.render(value.a, forcePrint) + ' ';
    output += this.position.b.render(value.b, forcePrint) + ' ';
    output += this.position.c.render(value.c, forcePrint) + ' ';
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
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the motion mode change (e.g., "G0", "G1").
   */
  public setMotionMode(value: 0 | 1, forcePrint?: boolean) {
    let output = '';
    output += this.motionMode.render(value, forcePrint);
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
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the homing command (e.g., "G28").
   */
  public setHomeNumber(value: number, forcePrint?: boolean) {
    let output = '';
    output += this._homeNumber.render(value, forcePrint);
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
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the feed rate change (e.g., "F500").
   */
  public setFeedRate(value: number, forcePrint?: boolean) {
    let output = '';
    output += this._feedRate.render(value, forcePrint);
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
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the spindle speed change (e.g., "S1200").
   */
  public setSpindleSpeed(value: number, forcePrint?: boolean) {
    let output = '';
    output += this._spindleSpeed.render(value, forcePrint);
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
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the spindle direction (e.g., "M3", "M4").
   */
  public setSpindleDirection(value: DirectionEnum, forcePrint?: boolean) {
    let output = '';
    output += this._spindleDirection.render(
      value === DirectionEnum.CW ? 3 : 4,
      forcePrint,
    );
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

  /**
   * @method selectTool
   * @description Selects the tool and returns the T-word G-code string.
   * @param {string} value - The tool number (e.g., "T1").
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the tool selection (e.g., "T1").
   */
  public selectTool(value: string, forcePrint?: boolean) {
    let output = '';
    output += this._tool.render(value, forcePrint);
    return output.trim();
  }
}
