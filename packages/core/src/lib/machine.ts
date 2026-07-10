import { DirectionEnum, PlaneEnum } from '../common/enums';
import type { Builder } from './builder';
import type {
  FEED_RATE_MODE,
  MACHINE_PLANE,
  MOTION_MODE,
  POSITIONING_MODE,
  SPINDLE_DIRECTION,
  UNIT_SYSTEM,
} from './constants';
import { Emitter } from './emitter';
import {
  createErrorContext,
  ErrorCollector,
  MachineStateError,
  ValidationError,
  wrapError,
} from './errors';
import { createLogger, LogLevel } from './logger';
import { assert } from './validation';

interface MachinePropertyTypes {
  machinePlane: (typeof MACHINE_PLANE)[keyof typeof MACHINE_PLANE];
  motionMode: (typeof MOTION_MODE)[keyof typeof MOTION_MODE];
  unitSystem: (typeof UNIT_SYSTEM)[keyof typeof UNIT_SYSTEM];
  positioningMode: (typeof POSITIONING_MODE)[keyof typeof POSITIONING_MODE];
  feedRateMode: (typeof FEED_RATE_MODE)[keyof typeof FEED_RATE_MODE];
  homeNumber: 54 | 55 | 56 | 57 | 58 | 59;
  spindleDirection: (typeof SPINDLE_DIRECTION)[keyof typeof SPINDLE_DIRECTION];
  feedRate: number;
  spindleSpeed: number;
  currentTool: string;
}

const formatLinearAxis = (value: number): string =>
  Object.is(value, -0) ? '-0' : value.toString();

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
    x: new Emitter('X', formatLinearAxis),
    y: new Emitter('Y', formatLinearAxis),
    z: new Emitter('Z', formatLinearAxis),
    a: new Emitter('A', (value) =>
      Number.isInteger(value) ? `${value}.` : value.toString(),
    ),
    b: new Emitter('B', (value) =>
      Number.isInteger(value) ? `${value}.` : value.toString(),
    ),
    c: new Emitter('C', (value) =>
      Number.isInteger(value) ? `${value}.` : value.toString(),
    ),
  };

  /**
   * @private
   * @property _machinePlane
   * @description Stores the current machine plane (G-code for machine plane).
   * Represented as a Emitter for G-code generation.
   */
  private _machinePlane: Emitter<MachinePropertyTypes['machinePlane']> =
    new Emitter('G');

  /**
   * @private
   * @property _motionMode
   * @description Stores the current motion mode (e.g., G00 for rapid, G01 for linear).
   * Represented as a Emitter for G-code generation.
   * 0 for G0 (Rapid), 1 for G1 (Linear Feed).
   */
  private _motionMode: Emitter<MachinePropertyTypes['motionMode']> =
    new Emitter('G');

  /**
   * @private
   * @property _unitSystem
   * @description Stores the current unit system (G-code for unit system).
   * Represented as a Emitter for G-code generation.
   */
  private _unitSystem: Emitter<MachinePropertyTypes['unitSystem']> =
    new Emitter('G');

  /**
   * @private
   * @property _positioningMode
   * @description Stores the current positioning mode (G-code for positioning mode).
   * Represented as a Emitter for G-code generation.
   */
  private _positioningMode: Emitter<MachinePropertyTypes['positioningMode']> =
    new Emitter('G');

  /**
   * @private
   * @property _feedRateMode
   * @description Stores the current feed rate mode (G-code for feed rate mode).
   * Represented as a Emitter for G-code generation.
   */
  private _feedRateMode: Emitter<MachinePropertyTypes['feedRateMode']> =
    new Emitter('G');

  /**
   * @private
   * @property _homeNumber
   * @description Stores the G-code for Homing (e.g. G28, G30).
   * This is usually a G-code like G28, G30 followed by axis letters or P for reference point number.
   * For simplicity here, it's just a number that will be prefixed with 'G'.
   */
  private _homeNumber: Emitter<MachinePropertyTypes['homeNumber']> =
    new Emitter('G');

  /**
   * @private
   * @property _feedRate
   * @description Stores the current feed rate (F-word).
   * Represented as a Emitter for G-code generation.
   */
  private _feedRate: Emitter<MachinePropertyTypes['feedRate']> = new Emitter(
    'F',
  );

  /**
   * @private
   * @property _spindleSpeed
   * @description Stores the current spindle speed (S-word).
   * Represented as a Emitter for G-code generation.
   */
  private _spindleSpeed: Emitter<MachinePropertyTypes['spindleSpeed']> =
    new Emitter('S');

  /**
   * @private
   * @property _spindleDirection
   * @description Stores the current spindle direction (M-word for M03, M04).
   * Represented as a Emitter for G-code generation.
   * 3 for M03 (Spindle ON Clockwise), 4 for M04 (Spindle ON Counter-Clockwise).
   */
  private _spindleDirection: Emitter<MachinePropertyTypes['spindleDirection']> =
    new Emitter('M');

  /**
   * @private
   * @property _currentTool
   * @description Stores the current tool (T-word).
   * Represented as a Emitter for G-code generation.
   */
  private _currentTool: Emitter<MachinePropertyTypes['currentTool']> =
    new Emitter('T', (value) => `="${value}"`);

  /**
   * @private
   * @property _logger
   * @description Logger instance for this machine
   */
  private _logger = createLogger('Machine');

  /**
   * @private
   * @property _errorCollector
   * @description Error collector for machine operations
   */
  private _errorCollector = new ErrorCollector();

  /**
   * @private
   * @property _stateOptions
   * @description Options for machine state management
   */
  private _stateOptions: MachineStateOptions = {
    validateTransitions: true,
    validateBounds: true,
    logStateChanges: true,
    logLevel: LogLevel.INFO,
  };

  /**
   * @constructor
   * @description Creates a new Machine instance with the given Builder.
   * @param _builder - The Builder instance used for generating G-code.
   * @param options - Optional machine state options
   */
  constructor(
    private _builder: Builder,
    options: MachineStateOptions = {},
  ) {
    try {
      assert(
        _builder !== null && _builder !== undefined,
        'Builder instance is required',
        'Machine',
        'constructor',
      );

      this._stateOptions = { ...this._stateOptions, ...options };
      this._logger.setLevel(this._stateOptions.logLevel || LogLevel.INFO);

      this._logger.info(
        'Machine initialized',
        {
          options: this._stateOptions,
        },
        'constructor',
      );
    } catch (error) {
      const wrappedError = wrapError(error, 'Machine', 'constructor');
      this._logger.logError(wrappedError, 'constructor');
      throw wrappedError;
    }
  }

  private _currentEvent(): Builder['currentEvent'] {
    return this._builder.currentEvent;
  }

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
    try {
      // Validate position values if validation is enabled
      if (this._stateOptions.validateBounds) {
        this._validatePositionValues(value);
      }

      let output = '';

      // Process each axis
      const axes = ['x', 'y', 'z', 'a', 'b', 'c'] as const;
      for (const axis of axes) {
        if (value[axis] !== undefined) {
          try {
            const rendered = this._position[axis].render(
              this._currentEvent(),
              this._builder.currentEventListenerIndex,
              value[axis],
              forcePrint,
            );
            output += `${rendered} `;
          } catch (error) {
            const machineError = new MachineStateError(
              `Failed to render ${axis.toUpperCase()} axis: ${
                error instanceof Error ? error.message : String(error)
              }`,
              createErrorContext(
                'Machine',
                'setPosition',
                {
                  axis,
                  value: value[axis],
                  forcePrint,
                },
                error instanceof Error ? error : undefined,
              ),
            );

            this._errorCollector.add(machineError);
            this._logger.logError(machineError, 'setPosition');

            if (!this._stateOptions.validateTransitions) {
              throw machineError;
            }
          }
        }
      }

      if (this._stateOptions.logStateChanges) {
        this._logger.debug(
          'Position updated',
          {
            newPosition: value,
            output: output.trim(),
            forcePrint,
          },
          'setPosition',
        );
      }

      return output.trim();
    } catch (error) {
      const wrappedError = wrapError(error, 'Machine', 'setPosition');
      this._logger.logError(wrappedError, 'setPosition');
      throw wrappedError;
    }
  }

  /**
   * @method _validatePositionValues
   * @description Validates position values are within machine bounds
   * @private
   */
  private _validatePositionValues(value: {
    x?: number;
    y?: number;
    z?: number;
    a?: number;
    b?: number;
    c?: number;
  }): void {
    const axes = ['x', 'y', 'z', 'a', 'b', 'c'] as const;
    for (const axis of axes) {
      const axisValue = value[axis];
      if (axisValue !== undefined) {
        if (typeof axisValue !== 'number' || !Number.isFinite(axisValue)) {
          throw new ValidationError(
            `Invalid ${axis.toUpperCase()} coordinate: must be a finite number`,
            createErrorContext('Machine', '_validatePositionValues', {
              axis,
              value: axisValue,
            }),
          );
        }
      }
    }
  }

  /**
   * @method setMachinePlane
   * @description Sets the machine's plane and returns the G-code string.
   * @param {PlaneEnum} value - XY, XZ, or YZ.
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the machine plane change (e.g., "G17", "G18", "G19").
   */
  public setMachinePlane(value: PlaneEnum, forcePrint?: boolean) {
    let output = '';
    let plane: MachinePropertyTypes['machinePlane'] = 17;

    switch (value) {
      case PlaneEnum.XY:
        plane = 17;
        break;
      case PlaneEnum.XZ:
        plane = 18;
        break;
      case PlaneEnum.YZ:
        plane = 19;
        break;
    }

    output += this._machinePlane.render(
      this._currentEvent(),
      this._builder.currentEventListenerIndex,
      plane,
      forcePrint,
    );
    return output.trim();
  }

  /**
   * @method setMotionMode
   * @description Sets the machine's motion mode (e.g., G00, G01) and returns the G-code string.
   * @param {0 | 1} value - 0 for G0 (Rapid), 1 for G1 (Linear Feed).
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the motion mode change (e.g., "G0", "G1").
   */
  public setMotionMode(
    value: MachinePropertyTypes['motionMode'],
    forcePrint?: boolean,
  ) {
    let output = '';
    output += this._motionMode.render(
      this._currentEvent(),
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
   * @returns {string} The G-code string for the unit system change (e.g., "G710").
   */
  public setUnitSystem(
    value: MachinePropertyTypes['unitSystem'],
    forcePrint?: boolean,
  ) {
    let output = '';
    output += this._unitSystem.render(
      this._currentEvent(),
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
  public setPositioningMode(
    value: MachinePropertyTypes['positioningMode'],
    forcePrint?: boolean,
  ) {
    let output = '';
    output += this._positioningMode.render(
      this._currentEvent(),
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
   * @method setFeedRateMode
   * @description Sets the machine's feed rate mode and returns the G-code string.
   * @param {94 | 95} value - 94 for G94 (units/min), 95 for G95 (units/rev).
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the feed rate mode change (e.g., "G94", "G95").
   */
  public setFeedRateMode(
    value: MachinePropertyTypes['feedRateMode'],
    forcePrint?: boolean,
  ) {
    let output = '';
    output += this._feedRateMode.render(
      this._currentEvent(),
      this._builder.currentEventListenerIndex,
      value,
      forcePrint,
    );
    return output.trim();
  }

  /**
   * @method setHomeNumber
   * @description Sets the machine's home position/reference point number and returns the G-code string.
   * @param {number} value - The home number (e.g., 28 for G28).
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the homing command (e.g., "G28").
   */
  public setHomeNumber(
    value: MachinePropertyTypes['homeNumber'],
    forcePrint?: boolean,
  ) {
    let output = '';
    output += this._homeNumber.render(
      this._currentEvent(),
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
  public setFeedRate(
    value: MachinePropertyTypes['feedRate'],
    forcePrint?: boolean,
  ) {
    try {
      // Validate feed rate value
      if (this._stateOptions.validateBounds) {
        this._validateFeedRate(value);
      }

      let output = '';
      try {
        output += this._feedRate.render(
          this._currentEvent(),
          this._builder.currentEventListenerIndex,
          value,
          forcePrint,
        );
      } catch (error) {
        const machineError = new MachineStateError(
          `Failed to render feed rate: ${
            error instanceof Error ? error.message : String(error)
          }`,
          createErrorContext(
            'Machine',
            'setFeedRate',
            {
              value,
              forcePrint,
            },
            error instanceof Error ? error : undefined,
          ),
        );

        this._errorCollector.add(machineError);
        this._logger.logError(machineError, 'setFeedRate');

        if (!this._stateOptions.validateTransitions) {
          throw machineError;
        }
      }

      if (this._stateOptions.logStateChanges) {
        this._logger.debug(
          'Feed rate updated',
          {
            newFeedRate: value,
            output: output.trim(),
            forcePrint,
          },
          'setFeedRate',
        );
      }

      return output.trim();
    } catch (error) {
      const wrappedError = wrapError(error, 'Machine', 'setFeedRate');
      this._logger.logError(wrappedError, 'setFeedRate');
      throw wrappedError;
    }
  }

  /**
   * @method setSpindleSpeed
   * @description Sets the machine's spindle speed and returns the S-word G-code string.
   * @param {number} value - The new spindle speed.
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string for the spindle speed change (e.g., "S1200").
   */
  public setSpindleSpeed(
    value: MachinePropertyTypes['spindleSpeed'],
    forcePrint?: boolean,
  ) {
    try {
      // Validate spindle speed value
      if (this._stateOptions.validateBounds) {
        this._validateSpindleSpeed(value);
      }

      let output = '';
      try {
        output += this._spindleSpeed.render(
          this._currentEvent(),
          this._builder.currentEventListenerIndex,
          value,
          forcePrint,
        );
      } catch (error) {
        const machineError = new MachineStateError(
          `Failed to render spindle speed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          createErrorContext(
            'Machine',
            'setSpindleSpeed',
            {
              value,
              forcePrint,
            },
            error instanceof Error ? error : undefined,
          ),
        );

        this._errorCollector.add(machineError);
        this._logger.logError(machineError, 'setSpindleSpeed');

        if (!this._stateOptions.validateTransitions) {
          throw machineError;
        }
      }

      if (this._stateOptions.logStateChanges) {
        this._logger.debug(
          'Spindle speed updated',
          {
            newSpeed: value,
            output: output.trim(),
            forcePrint,
          },
          'setSpindleSpeed',
        );
      }

      return output.trim();
    } catch (error) {
      const wrappedError = wrapError(error, 'Machine', 'setSpindleSpeed');
      this._logger.logError(wrappedError, 'setSpindleSpeed');
      throw wrappedError;
    }
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
    let direction: 3 | 4 = 3;

    switch (value) {
      case DirectionEnum.CW:
      case DirectionEnum.CWF:
      case DirectionEnum.CWT:
        direction = 3;
        break;
      case DirectionEnum.CCW:
      case DirectionEnum.CCWF:
      case DirectionEnum.CCWT:
        direction = 4;
        break;
    }

    output += this._spindleDirection.render(
      this._currentEvent(),
      this._builder.currentEventListenerIndex,
      direction,
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
  public selectTool(
    value: MachinePropertyTypes['currentTool'],
    forcePrint?: boolean,
  ) {
    try {
      // Validate tool value
      if (this._stateOptions.validateBounds) {
        this._validateTool(value);
      }

      let output = '';
      try {
        output += this._currentTool.render(
          this._currentEvent(),
          this._builder.currentEventListenerIndex,
          value,
          forcePrint,
        );
      } catch (error) {
        const machineError = new MachineStateError(
          `Failed to render tool selection: ${
            error instanceof Error ? error.message : String(error)
          }`,
          createErrorContext(
            'Machine',
            'selectTool',
            {
              value,
              forcePrint,
            },
            error instanceof Error ? error : undefined,
          ),
        );

        this._errorCollector.add(machineError);
        this._logger.logError(machineError, 'selectTool');

        if (!this._stateOptions.validateTransitions) {
          throw machineError;
        }
      }

      if (this._stateOptions.logStateChanges) {
        this._logger.debug(
          'Tool selected',
          {
            tool: value,
            output: output.trim(),
            forcePrint,
          },
          'selectTool',
        );
      }

      return output.trim();
    } catch (error) {
      const wrappedError = wrapError(error, 'Machine', 'selectTool');
      this._logger.logError(wrappedError, 'selectTool');
      throw wrappedError;
    }
  }

  /**
   * @method _validateFeedRate
   * @description Validates feed rate value is within acceptable bounds
   * @private
   */
  private _validateFeedRate(value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(
        'Feed rate must be a finite number',
        createErrorContext('Machine', '_validateFeedRate', { value }),
      );
    }

    if (value < 0) {
      throw new ValidationError(
        'Feed rate cannot be negative',
        createErrorContext('Machine', '_validateFeedRate', { value }),
      );
    }

    if (value > 50000) {
      // Common CNC feed rate limit
      throw new ValidationError(
        'Feed rate exceeds maximum limit (50000 mm/min)',
        createErrorContext('Machine', '_validateFeedRate', { value }),
      );
    }
  }

  /**
   * @method _validateSpindleSpeed
   * @description Validates spindle speed value is within acceptable bounds
   * @private
   */
  private _validateSpindleSpeed(value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(
        'Spindle speed must be a finite number',
        createErrorContext('Machine', '_validateSpindleSpeed', { value }),
      );
    }

    if (value < 0) {
      throw new ValidationError(
        'Spindle speed cannot be negative',
        createErrorContext('Machine', '_validateSpindleSpeed', { value }),
      );
    }

    if (value > 50000) {
      // Common CNC spindle speed limit
      throw new ValidationError(
        'Spindle speed exceeds maximum limit (50000 RPM)',
        createErrorContext('Machine', '_validateSpindleSpeed', { value }),
      );
    }
  }

  /**
   * @method _validateTool
   * @description Validates tool value is acceptable
   * @private
   */
  private _validateTool(value: string): void {
    if (typeof value !== 'string') {
      throw new ValidationError(
        'Tool must be a string',
        createErrorContext('Machine', '_validateTool', { value }),
      );
    }

    if (value.length === 0) {
      throw new ValidationError(
        'Tool value cannot be empty',
        createErrorContext('Machine', '_validateTool', { value }),
      );
    }

    // Basic tool validation - allow Siemens-style named tools like TAPG1/4.
    if (!/^[./ A-Za-z0-9_-]+$/.test(value)) {
      throw new ValidationError(
        'Tool must contain only safe Siemens tool-name characters',
        createErrorContext('Machine', '_validateTool', { value }),
      );
    }
  }
}

/**
 * @interface MachineStateOptions
 * @description Options for machine state management
 */
export interface MachineStateOptions {
  /**
   * Whether to validate state transitions
   */
  validateTransitions?: boolean;
  /**
   * Whether to validate parameter bounds
   */
  validateBounds?: boolean;
  /**
   * Whether to log state changes
   */
  logStateChanges?: boolean;
  /**
   * Log level for machine operations
   */
  logLevel?: LogLevel;
}
