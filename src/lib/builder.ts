import type { CommandsType } from '$src/types';
import { Machine } from './machine';

/**
 * Interface for command options
 */
export interface CommandOptions {
  /**
   * Force printing values even if redundant
   */
  forcePrint?: boolean;
  /**
   * Don't flush to a new line after command
   */
  skipNewLine?: boolean;
}

/**
 * @description Configuration options for the Builder class
 */
export type BuilderOptions = {
  /**
   * Settings for line numbering in generated G-code
   */
  numbering: {
    /**
     * Whether to enable line numbering (N-words), default is true
     */
    enabled: boolean;
    /**
     * The starting line number, default is 10
     */
    start: number;
    /**
     * The increment between line numbers, default is 10
     */
    increment: number;
  };
};

/**
 * @class Builder
 * @description A class to construct a G-code program by accumulating G-code commands,
 * formatting them with line numbers (N-words), and managing the machine state
 * via the Machine class.
 */
export class Builder {
  /**
   * @private
   * @property _options
   * @description The options for the Program.
   */
  private readonly _options: BuilderOptions = {
    numbering: {
      enabled: true,
      start: 10,
      increment: 10,
    },
  };

  /**
   * @private
   * @property _machine
   * @description An instance of the Machine class to manage CNC machine state and generate G-code words.
   */
  private _machine = new Machine();

  /**
   * @private
   * @property _lines
   * @description An array to store the fully formatted G-code lines (e.g., "N10 G00 X100 Y50").
   */
  private _lines: string[] = [];

  /**
   * @private
   * @property _currentLine
   * @description A buffer to accumulate G-code words for the current line before it's finalized.
   */
  private _currentLine: string[] = [];

  /**
   * @private
   * @property _currentLineNumber
   * @description The current G-code line number (N-word). It increments by a fixed step after flushing the current line (e.g., 10).
   */
  private _currentLineNumber = 10;

  /**
   * @constructor
   * @description Initializes a new Builder instance with the given options
   * @param {BuilderOptions} [options] - Optional configuration options
   */
  constructor(options?: BuilderOptions) {
    this._options = {
      numbering: {
        enabled: options?.numbering.enabled ?? this._options.numbering.enabled,
        start: options?.numbering.start ?? this._options.numbering.start,
        increment:
          options?.numbering.increment ?? this._options.numbering.increment,
      },
    };
    this._currentLineNumber = this._options.numbering.start;
  }

  /**
   * @property {string} gcode
   * @description Returns the complete G-code program as a single string,
   * with individual G-code lines joined by newline characters.
   * @readonly
   */
  public get gcode(): string {
    return this._lines.join('\n');
  }

  /**
   * @method put
   * @description Adds a G-code word or segment (e.g., "G00", "X100", "M03") to the current line being built.
   * Sections should be valid G-code words. Empty strings will be ignored by `flush`.
   * @param {string} section - The G-code segment to add to the current line.
   * @param {boolean} [flush] - Whether to flush the current line after adding the section.
   */
  public put(section: string, flush?: boolean): void {
    if (section && section.trim().length > 0) {
      // Ensure non-empty sections are added
      this._currentLine.push(section.trim());
    }
    if (flush) {
      this.flush();
    }
  }

  /**
   * @method flush
   * @description Finalizes the current G-code line. If the `_currentLine` buffer contains any words,
   * it prepends the line number (N-word), joins the words with spaces, trims whitespace,
   * adds it to the `_lines` array, clears the `_currentLine` buffer, and increments the `_lineNumber`.
   */
  public flush(): void {
    if (this._currentLine.length > 0 && this._currentLine.join('').length > 0) {
      this._lines.push(
        (this._options.numbering.enabled
          ? `N${parseInt(this._currentLineNumber.toString())} `
          : '') + this._currentLine.join(' ').trim(),
      );
      this._currentLine = [];
      this._currentLineNumber += this._options.numbering.increment;
    }
  }

  /**
   * @method Rapid
   * @description Generates G-code for a rapid positioning move (typically G00).
   * It sets the machine's motion mode to rapid and then sets the target position.
   * @param {CommandsType['Rapid']} params - An object containing the target coordinates (e.g., { x, y, z }).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   * @example 'G0 X100 Y50 Z10'
   */
  public Rapid(params: CommandsType['Rapid'], options?: CommandOptions): void {
    this.put(this._machine.setMotionMode(0, options?.forcePrint));
    this.put(this._machine.setPosition(params, options?.forcePrint));
    if (!options?.skipNewLine) {
      this.flush();
    }
  }

  /**
   * @method Line
   * @description Generates G-code for a linear interpolation move (typically G01).
   * It sets the machine's motion mode to linear and then sets the target position.
   * A feed rate should typically be active for G01 moves.
   * @param {CommandsType['Line']} params - An object containing the target coordinates (e.g., { x, y, z }).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   * @example 'G1 X100 Y50 Z10'
   */
  public Line(params: CommandsType['Line'], options?: CommandOptions): void {
    this.put(this._machine.setMotionMode(1, options?.forcePrint));
    this.put(this._machine.setPosition(params, options?.forcePrint));
    if (!options?.skipNewLine) {
      this.flush();
    }
  }

  /**
   * @method SetSpindleSpeed
   * @description Generates G-code to set the spindle speed (S-word).
   * @param {CommandsType['SetSpindleSpeed']} speed - The desired spindle speed.
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetSpindleSpeed(
    speed: CommandsType['SetSpindleSpeed'],
    options?: CommandOptions,
  ): void {
    this.put(this._machine.setSpindleSpeed(speed, options?.forcePrint));
    if (!options?.skipNewLine) {
      this.flush();
    }
  }

  /**
   * @method SetSpindleDirection
   * @description Generates G-code to set the spindle rotation direction (e.g., M03 for clockwise, M04 for counter-clockwise).
   * @param {CommandsType['SetSpindleDirection']} direction - The desired spindle direction, typically from an enum.
   * @param {CommandOptions} [options] - Optional settings for command generation.
   * @example 'M3'
   */
  public SetSpindleDirection(
    direction: CommandsType['SetSpindleDirection'],
    options?: CommandOptions,
  ): void {
    this.put(this._machine.setSpindleDirection(direction, options?.forcePrint));
    if (!options?.skipNewLine) {
      this.flush();
    }
  }

  /**
   * @method SetFeedRate
   * @description Generates G-code to set the feed rate (F-word).
   * @param {CommandsType['SetFeedRate']} feedRate - The desired feed rate.
   * @param {CommandOptions} [options] - Optional settings for command generation.
   * @example 'F100'
   */
  public SetFeedRate(
    feedRate: CommandsType['SetFeedRate'],
    options?: CommandOptions,
  ): void {
    this.put(this._machine.setFeedRate(feedRate, options?.forcePrint));
    if (!options?.skipNewLine) {
      this.flush();
    }
  }

  /**
   * @method SelectTool
   * @description Generates G-code to select a tool (T-word).
   * @param {CommandsType['SelectTool']} toolNumber - The desired tool number.
   * @param {CommandOptions} [options] - Optional settings for command generation.
   * @example 'T="T123"'
   */
  public SelectTool(
    toolNumber: CommandsType['SelectTool'],
    options?: CommandOptions,
  ): void {
    this.put(this._machine.selectTool(toolNumber, options?.forcePrint));
    if (!options?.skipNewLine) {
      this.flush();
    }
  }

  public ChangeTool(options?: CommandOptions): void {
    this.put('M6');
    if (!options?.skipNewLine) {
      this.flush();
    }
  }
}
