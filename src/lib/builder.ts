import type { PlanEnum } from '$src/common/enums';
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
export interface BuilderOptions {
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
}

export interface FileOptions {
  numbering: BuilderOptions['numbering'];
}

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
    type: 'Main' | 'Sub' = 'Sub',
    options?: DeepPartial<FileOptions>,
  ) {
    this.name = name;
    this.type = type;
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
   * @public
   * @property type
   * @description The type of the file.
   */
  public readonly type: 'Main' | 'Sub';

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
   * @param {boolean} [skipNewLine] - Whether to skip a new line after adding the section.
   */
  public put(section: string, skipNewLine?: boolean): void {
    if (section && section.trim().length > 0) {
      // Ensure non-empty sections are added
      this._currentLine.push(section.trim());
    }
    if (!skipNewLine) {
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
    this.mainFile = new File(this, this._options.mainFileName, 'Main');
    this._files.push(this.mainFile);
    this.currentFile = this.mainFile;
    this._machine = new Machine(this);
  }

  /**
   * @public
   * @property mainFile
   * @description The main file.
   */
  public mainFile: File;

  /**
   * @public
   * @property currentFile
   * @description The current file.
   */
  public currentFile: File;

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
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public put(section: string, options?: CommandOptions): void {
    this.currentFile.put(section, options?.skipNewLine);
    if (!options?.skipNewLine) {
      this.currentFile.flush();
    }
  }

  /**
   * @method flush
   * @description Finalizes the current G-code line in the current file. If the `_currentLine` buffer contains any words,
   * it prepends the line number (N-word), joins the words with spaces, trims whitespace,
   * adds it to the `_lines` array, clears the `_currentLine` buffer, and increments the `_lineNumber`.
   */
  public flush(): void {
    this.currentFile.flush();
  }

  /**
   * @method NewSubProgram
   * @description Creates a new subprogram with the given name.
   * @param {string} name - The name of the new subprogram.
   * @throws {Error} If the builder is currently in a subprogram.
   */
  public NewSubProgram(name: string): void {
    // If builder is not currently in the main file, throw and error as its only possible to create new files in the main file
    if (this.currentFile !== this.mainFile) {
      throw new Error('Cannot create new files in non-main (MPF) files');
    }
    this._files.push(new File(this, name + '.SPF'));
    this.currentFile = this._files[this._files.length - 1];
  }

  /**
   * @method EndSubProgram
   * @description Ends the current subprogram.
   * @throws {Error} If the builder is currently in the main file.
   */
  public EndSubProgram(): void {
    // If builder is currently in the main file, throw and error as its only possible to end the main file
    if (this.currentFile === this.mainFile) {
      throw new Error('Cannot end the main (MPF) file');
    }

    this.currentFile = this.mainFile;
  }

  /**
   * @method Call
   * @description Generates G-code to call a subprogram (SPF).
   * @param {string} name - The name of the subprogram to call.
   */
  public Call(params: CommandsType['Call'], options?: CommandOptions): void {
    this.put(`CALL "${params}"`, options);
  }

  /**
   * @method ExtCall
   * @description Generates G-code to call a subprogram (SPF) from an external source (e.g., a USB drive).
   * @param {string} name - The name of the subprogram to call.
   */
  public ExtCall(
    params: CommandsType['ExtCall'],
    options?: CommandOptions,
  ): void {
    this.put(`EXTCALL "${params}"`, options);
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
    this.put(this._machine.setMotionMode(0, options?.forcePrint), {
      skipNewLine: options?.skipNewLine ?? true,
      forcePrint: options?.forcePrint,
    });
    this.put(this._machine.setPosition(params, options?.forcePrint), options);
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
    this.put(this._machine.setMotionMode(1, options?.forcePrint), {
      skipNewLine: options?.skipNewLine ?? true,
      forcePrint: options?.forcePrint,
    });
    this.put(this._machine.setPosition(params, options?.forcePrint), options);
  }

  /**
   * @method SetMachinePlane
   * @description Generates G-code to set the machine's plane (G17, G18, G19).
   * @param {PlanEnum} plane - The desired machine plane.
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetMachinePlane(
    plane: CommandsType['SetMachinePlane'],
    options?: CommandOptions,
  ): void {
    this.put(
      this._machine.setMachinePlane(plane, options?.forcePrint),
      options,
    );
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
    this.put(
      this._machine.setSpindleSpeed(speed, options?.forcePrint),
      options,
    );
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
    this.put(
      this._machine.setSpindleDirection(direction, options?.forcePrint),
      options,
    );
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
    this.put(this._machine.setFeedRate(feedRate, options?.forcePrint), options);
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
    this.put(
      this._machine.selectTool(toolNumber, options?.forcePrint),
      options,
    );
  }

  /**
   * @method ChangeTool
   * @description Generates G-code to change the tool (M6).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public ChangeTool(options?: CommandOptions): void {
    this.put('M6', options);
  }

  /**
   * @method UseMillimeters
   * @description Generates G-code to set the machine to use millimeters (G710).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public UseMillimeters(options?: CommandOptions): void {
    this.put(this._machine.setUnitSystem(710, options?.forcePrint), options);
  }

  /**
   * @method UseInches
   * @description Generates G-code to set the machine to use inches (G700).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public UseInches(options?: CommandOptions): void {
    this.put(this._machine.setUnitSystem(700, options?.forcePrint), options);
  }

  /**
   * @method SetAbsoluteMode
   * @description Generates G-code to set the machine to absolute mode (G90).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetAbsoluteMode(options?: CommandOptions): void {
    this.put(
      this._machine.setPositioningMode(90, options?.forcePrint),
      options,
    );
  }

  /**
   * @method SetIncrementalMode
   * @description Generates G-code to set the machine to incremental mode (G91).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetIncrementalMode(options?: CommandOptions): void {
    this.put(
      this._machine.setPositioningMode(91, options?.forcePrint),
      options,
    );
  }

  /**
   * @method SetFeedRateMode
   * @description Generates G-code to set the feed rate mode (G94 or G95).
   * @param {94 | 95} mode - The desired feed rate mode (G94 or G95).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetFeedRateMode(mode: 94 | 95, options?: CommandOptions): void {
    this.put(this._machine.setFeedRateMode(mode, options?.forcePrint), options);
  }
}
