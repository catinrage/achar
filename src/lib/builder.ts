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
  noFlush?: boolean;
}

/**
 * @class Builder
 * @description A class to construct a G-code program by accumulating G-code commands,
 * formatting them with line numbers (N-words), and managing the machine state
 * via the Machine class.
 */
export class Builder {
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
   * @property _lineNumber
   * @description The current G-code line number (N-word). It typically increments by a fixed step (e.g., 10).
   */
  private _lineNumber = 10;

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
   */
  public put(section: string): void {
    if (section && section.trim().length > 0) { // Ensure non-empty sections are added
      this._currentLine.push(section.trim());
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
        `N${this._lineNumber} ` + this._currentLine.join(' ').trim(),
      );
      this._currentLine = [];
      this._lineNumber += 10;
    }
  }

  /**
   * @method Rapid
   * @description Generates G-code for a rapid positioning move (typically G00).
   * It sets the machine's motion mode to rapid and then sets the target position.
   * @param {CommandsType['Rapid']} params - An object containing the target coordinates (e.g., { x, y, z }).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public Rapid(params: CommandsType['Rapid'], options?: CommandOptions): void {
    this.put(this._machine.setMotionMode(0, options?.forcePrint));
    this.put(this._machine.setPosition(params, options?.forcePrint));
    if (!options?.noFlush) {
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
   */
  public Line(params: CommandsType['Line'], options?: CommandOptions): void {
    this.put(this._machine.setMotionMode(1, options?.forcePrint));
    this.put(this._machine.setPosition(params, options?.forcePrint));
    if (!options?.noFlush) {
      this.flush();
    }
  }

  /**
   * @method SetSpindleSpeed
   * @description Generates G-code to set the spindle speed (S-word).
   * @param {CommandsType['SetSpindleSpeed']} speed - The desired spindle speed.
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetSpindleSpeed(speed: CommandsType['SetSpindleSpeed'], options?: CommandOptions): void {
    this.put(this._machine.setSpindleSpeed(speed, options?.forcePrint));
    if (!options?.noFlush) {
      this.flush();
    }
  }

  /**
   * @method SetSpindleDirection
   * @description Generates G-code to set the spindle rotation direction (e.g., M03 for clockwise, M04 for counter-clockwise).
   * @param {CommandsType['SetSpindleDirection']} direction - The desired spindle direction, typically from an enum.
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetSpindleDirection(
    direction: CommandsType['SetSpindleDirection'],
    options?: CommandOptions,
  ): void {
    this.put(this._machine.setSpindleDirection(direction, options?.forcePrint));
    if (!options?.noFlush) {
      this.flush();
    }
  }
}
