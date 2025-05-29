import type { CommandsType, DeepPartial, EventsType } from '$src/types';
import { Machine } from './machine';
import type { Event } from './program';

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
   * The name of the main file, default is 'Setup.MPF'
   */
  mainFileName: string;
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

export type FileOptions = {
  numbering: BuilderOptions['numbering'];
};

export class File {
  /**
   * @private
   * @property _builder
   * @description The builder instance.
   */
  private readonly _builder: Builder;

  /**
   * @private
   * @property _options
   * @description The options for the file.
   */
  private readonly _options: FileOptions = {
    numbering: {
      enabled: true,
      start: 10,
      increment: 10,
    },
  };

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
   * @description Initializes a new File instance.
   * @param {Builder} builder - The builder instance.
   * @param {string} name - The name of the file.
   * @param {DeepPartial<FileOptions>} [options] - Optional settings for the file.
   */
  constructor(
    builder: Builder,
    name: string,
    options?: DeepPartial<FileOptions>,
  ) {
    this.name = name;
    this._builder = builder;
    this._options = {
      numbering: {
        enabled: options?.numbering?.enabled ?? this._options.numbering.enabled,
        start: options?.numbering?.start ?? this._options.numbering.start,
        increment:
          options?.numbering?.increment ?? this._options.numbering.increment,
      },
    };
  }

  /**
   * @private
   * @property name
   * @description The name of the file.
   */
  public readonly name: string;

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
   * @property _options
   * @description The options for the Program.
   */
  private readonly _options: BuilderOptions = {
    mainFileName: 'Setup.MPF',
    numbering: {
      enabled: true,
      start: 10,
      increment: 10,
    },
  };

  /**
   * @private
   * @property _files
   * @description An array to store the files.
   */
  private readonly _files: File[] = [];

  /**
   * @private
   * @property _mainFile
   * @description The main file.
   */
  private _mainFile: File;

  /**
   * @private
   * @property _currentFile
   * @description The current file.
   */
  private _currentFile: File;

  /**
   * @private
   * @property _machine
   * @description An instance of the Machine class to manage CNC machine state and generate G-code words.
   */
  private _machine: Machine;

  /**
   * @constructor
   * @description Initializes a new Builder instance with the given options
   * @param {BuilderOptions} [options] - Optional configuration options
   */
  constructor(options?: DeepPartial<BuilderOptions>) {
    this._options = {
      mainFileName: options?.mainFileName ?? this._options.mainFileName,
      numbering: {
        enabled: options?.numbering?.enabled ?? this._options.numbering.enabled,
        start: options?.numbering?.start ?? this._options.numbering.start,
        increment:
          options?.numbering?.increment ?? this._options.numbering.increment,
      },
    };
    this._mainFile = new File(this, this._options.mainFileName);
    this._files.push(this._mainFile);
    this._currentFile = this._mainFile;
    this._machine = new Machine(this);
  }

  /**
   * @public
   * @property currentEvent
   * @description The current event being processed.
   */
  public currentEvent: Event<keyof EventsType> | null = null;

  /**
   * @public
   * @property currentEventListenerIndex
   * @description The index of the current event listener being processed.
   */
  public currentEventListenerIndex: number = 0;

  /**
   * @method build
   * @description Builds the G-code program.
   * @returns {Array<{ file: string; code: string }>} An array of objects containing the file name and the G-code code.
   */
  public build(): {
    file: string;
    code: string;
  }[] {
    return this._files.map((file) => ({
      file: file.name,
      code: file.gcode,
    }));
  }

  /**
   * @method put
   * @description Adds a G-code word or segment (e.g., "G00", "X100", "M03") to the current line being built.
   * Sections should be valid G-code words. Empty strings will be ignored by `flush`.
   * @param {string} section - The G-code segment to add to the current line.
   * @param {boolean} [flush] - Whether to flush the current line after adding the section.
   */
  public put(section: string, flush?: boolean): void {
    this._currentFile.put(section, flush);
  }

  /**
   * @method flush
   * @description Finalizes the current G-code line. If the `_currentLine` buffer contains any words,
   * it prepends the line number (N-word), joins the words with spaces, trims whitespace,
   * adds it to the `_lines` array, clears the `_currentLine` buffer, and increments the `_lineNumber`.
   */
  public flush(): void {
    this._currentFile.flush();
  }

  /**
   * @method NewSubProgram
   * @description Creates a new subprogram with the given name.
   * @param {string} name - The name of the new subprogram.
   * @throws {Error} If the builder is currently in a subprogram.
   */
  public NewSubProgram(name: string): void {
    // If builder is not currently in the main file, throw and error as its only possible to create new files in the main file
    if (this._currentFile !== this._mainFile) {
      throw new Error('Cannot create new files in non-main (MPF) files');
    }
    this._files.push(new File(this, name + '.SPF'));
    this._currentFile = this._files[this._files.length - 1];
  }

  /**
   * @method EndSubProgram
   * @description Ends the current subprogram.
   * @throws {Error} If the builder is currently in the main file.
   */
  public EndSubProgram(): void {
    // If builder is currently in the main file, throw and error as its only possible to end the main file
    if (this._currentFile === this._mainFile) {
      throw new Error('Cannot end the main (MPF) file');
    }

    this._currentFile = this._mainFile;
  }

  /**
   * @method Call
   * @description Generates G-code to call a subprogram (SPF).
   * @param {string} name - The name of the subprogram to call.
   */
  public Call(name: string): void {
    this.put(`CALL "${name}.SPF"`, true);
  }

  /**
   * @method ExtCall
   * @description Generates G-code to call a subprogram (SPF) from an external source (e.g., a USB drive).
   * @param {string} name - The name of the subprogram to call.
   */
  public ExtCall(name: string): void {
    this.put(`EXTCALL "${name}.SPF"`);
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
      this._currentFile.flush();
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
      this._currentFile.flush();
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
      this._currentFile.flush();
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
      this._currentFile.flush();
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
      this._currentFile.flush();
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
      this._currentFile.flush();
    }
  }

  /**
   * @method ChangeTool
   * @description Generates G-code to change the tool (M6).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public ChangeTool(options?: CommandOptions): void {
    this.put('M6');
    if (!options?.skipNewLine) {
      this._currentFile.flush();
    }
  }

  /**
   * @method SetAbsoluteMode
   * @description Generates G-code to set the machine to absolute mode (G90).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetAbsoluteMode(options?: CommandOptions): void {
    this.put(this._machine.setPositioningMode(90, options?.forcePrint));
    if (!options?.skipNewLine) {
      this._currentFile.flush();
    }
  }

  /**
   * @method SetIncrementalMode
   * @description Generates G-code to set the machine to incremental mode (G91).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetIncrementalMode(options?: CommandOptions): void {
    this.put(this._machine.setPositioningMode(91, options?.forcePrint));
    if (!options?.skipNewLine) {
      this._currentFile.flush();
    }
  }

  /**
   * @method UseMillimeters
   * @description Generates G-code to set the machine to use millimeters (G21).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public UseMillimeters(options?: CommandOptions): void {
    this.put(this._machine.setUnitSystem(21, options?.forcePrint));
    if (!options?.skipNewLine) {
      this._currentFile.flush();
    }
  }

  /**
   * @method UseInches
   * @description Generates G-code to set the machine to use inches (G20).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public UseInches(options?: CommandOptions): void {
    this.put(this._machine.setUnitSystem(20, options?.forcePrint));
    if (!options?.skipNewLine) {
      this._currentFile.flush();
    }
  }
}
