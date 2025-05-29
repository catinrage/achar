import { DirectionEnum } from '$src/common/enums';
import type { Builder } from './builder';
import { Emitter } from './emitter';

/**
 * @class Machine
 * @description Represents the state of a CNC machine. It tracks various parameters
 * like position, motion mode, feed rate, and spindle status.
 * Methods in this class are used to update the machine state and generate
 * corresponding G-code segments. It utilizes the Emitter class to ensure
 * that G-code is only output for parameters that have changed.
 */
export class Machine {
  /**
   * @private
   * @property _position
   * @description Stores the machine's current coordinates (X, Y, Z, A, B, C).
   * Each axis is a Emitter to manage its G-code output.
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
   * Represented as a Emitter for G-code generation.
   * 0 for G0 (Rapid), 1 for G1 (Linear Feed).
   */
  private _motionMode: Emitter<0 | 1> = new Emitter('G');

  /**
   * @private
   * @property _unitSystem
   * @description Stores the current unit system (G-code for unit system).
   * Represented as a Emitter for G-code generation.
   */
  private _unitSystem: Emitter<20 | 21> = new Emitter('G');

  /**
   * @private
   * @property _positioningMode
   * @description Stores the current positioning mode (G-code for positioning mode).
   * Represented as a Emitter for G-code generation.
   */
  private _positioningMode: Emitter<90 | 91> = new Emitter('G');

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
   * Represented as a Emitter for G-code generation.
   */
  private _feedRate: Emitter<number> = new Emitter('F');

  /**
   * @private
   * @property _spindleSpeed
   * @description Stores the current spindle speed (S-word).
   * Represented as a Emitter for G-code generation.
   */
  private _spindleSpeed: Emitter<number> = new Emitter('S');

  /**
   * @private
   * @property _spindleDirection
   * @description Stores the current spindle direction (M-word for M03, M04).
   * Represented as a Emitter for G-code generation.
   * 3 for M03 (Spindle ON Clockwise), 4 for M04 (Spindle ON Counter-Clockwise).
   */
  private _spindleDirection: Emitter<3 | 4> = new Emitter('M');

  /**
   * @private
   * @property _currentTool
   * @description Stores the current tool (T-word).
   * Represented as a Emitter for G-code generation.
   */
  private _currentTool: Emitter<string> = new Emitter(
    'T',
    (value) => `="${value}"`,
  );

  /**
   * @constructor
   * @description Creates a new Machine instance with the given Builder.
   * @param _builder - The Builder instance used for generating G-code.
   */
  constructor(private _builder: Builder) {}

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
    output +=
      this._position.x.render(
        this._builder.currentEvent!,
        this._builder.currentEventListenerIndex,
        value.x,
        forcePrint,
      ) + ' ';
    output +=
      this._position.y.render(
        this._builder.currentEvent!,
        this._builder.currentEventListenerIndex,
        value.y,
        forcePrint,
      ) + ' ';
    output +=
      this._position.z.render(
        this._builder.currentEvent!,
        this._builder.currentEventListenerIndex,
        value.z,
        forcePrint,
      ) + ' ';
    output +=
      this._position.a.render(
        this._builder.currentEvent!,
        this._builder.currentEventListenerIndex,
        value.a,
        forcePrint,
      ) + ' ';
    output +=
      this._position.b.render(
        this._builder.currentEvent!,
        this._builder.currentEventListenerIndex,
        value.b,
        forcePrint,
      ) + ' ';
    output +=
      this._position.c.render(
        this._builder.currentEvent!,
        this._builder.currentEventListenerIndex,
        value.c,
        forcePrint,
      ) + ' ';
    output = output.replace(/\s+/g, ' ');
    return output.trim();
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
    output += this._motionMode.render(
      this._builder.currentEvent!,
      this._builder.currentEventListenerIndex,
      value,
      forcePrint,
    );
    return output.trim();
  }

  /**
   * @method setUnitSystem
   * @description Sets the machine's unit system and returns the G-code string.
   * @param {number} value - The unit system (0 for metric, 1 for imperial).
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the unit system change (e.g., "G21").
   */
  public setUnitSystem(value: 20 | 21, forcePrint?: boolean) {
    let output = '';
    output += this._unitSystem.render(
      this._builder.currentEvent!,
      this._builder.currentEventListenerIndex,
      value,
      forcePrint,
    );
    if (!forcePrint) {
      output += ' ';
    }
    return output.trim();
  }

  /**
   * @method setPositioningMode
   * @description Sets the machine's positioning mode and returns the G-code string.
   * @param {90 | 91} value - 90 for G90 (Absolute), 91 for G91 (Relative).
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the positioning mode change (e.g., "G90", "G91").
   */
  public setPositioningMode(value: 90 | 91, forcePrint?: boolean) {
    let output = '';
    output += this._positioningMode.render(
      this._builder.currentEvent!,
      this._builder.currentEventListenerIndex,
      value,
      forcePrint,
    );
    if (!forcePrint) {
      output += ' ';
    }
    return output.trim();
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
    output += this._homeNumber.render(
      this._builder.currentEvent!,
      this._builder.currentEventListenerIndex,
      value,
      forcePrint,
    );
    return output.trim();
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
    output += this._feedRate.render(
      this._builder.currentEvent!,
      this._builder.currentEventListenerIndex,
      value,
      forcePrint,
    );
    return output.trim();
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
    output += this._spindleSpeed.render(
      this._builder.currentEvent!,
      this._builder.currentEventListenerIndex,
      value,
      forcePrint,
    );
    return output.trim();
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
      this._builder.currentEvent!,
      this._builder.currentEventListenerIndex,
      value === DirectionEnum.CW ? 3 : 4,
      forcePrint,
    );
    return output.trim();
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
    output += this._currentTool.render(
      this._builder.currentEvent!,
      this._builder.currentEventListenerIndex,
      value,
      forcePrint,
    );
    return output.trim();
  }
}
