import type { CommandsType, DeepPartial, EventsType } from '../types';
import type { BuilderDriver } from './driver';
import type { Event } from './event';
import { File } from './file';
import type { LogLevel } from './logger';
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
  /**
   * Preserve intentional leading and trailing whitespace in the emitted block.
   * Controller drivers use this for structured control-flow indentation.
   */
  preserveWhitespace?: boolean;
  /** Human-readable explanation shown by diagnostics. */
  reason?: string;
}

export interface EmissionDiagnostic {
  file: string;
  command: string;
  event?: string;
  eventIndex?: number;
  listenerIndex: number;
  reason?: string;
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

export type GCodeWordLetter =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'X'
  | 'Y'
  | 'Z';

export interface GCodeWord {
  letter: GCodeWordLetter;
  value: string | number;
}

/**
 * @interface BuilderExecutionOptions
 * @description Options for builder execution
 */
export interface BuilderExecutionOptions {
  /**
   * Whether to validate commands before adding them
   */
  validateCommands?: boolean;
  /**
   * Whether to continue on command errors
   */
  continueOnError?: boolean;
  /**
   * Maximum number of errors before stopping
   */
  maxErrors?: number;
  /**
   * Whether to log building progress
   */
  logProgress?: boolean;
  /**
   * Log level for building operations
   */
  logLevel?: LogLevel;
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
   * @property _currentLineNumber
   * @description Shared N-word counter used across every file emitted by this builder.
   */
  private _currentLineNumber = 10;

  /**
   * @private
   * @property _machine
   * @description An instance of the Machine class to manage CNC machine state and generate G-code words.
   */
  private _machine: Machine;

  private readonly _drivers = new Map<string, object>();

  private readonly _driverCapabilities = new Map<string, ReadonlySet<string>>();

  private readonly _diagnostics: EmissionDiagnostic[] = [];

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
    this._currentLineNumber = this._options.numbering.start;
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

  public currentEventIndex: number = -1;

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
   * @deprecated Prefer typed Builder helpers such as `Block`, `Word`, `Rapid`, `Line`,
   * or a controller driver via `driver(...)`. Use `put` only as an escape hatch.
   * @param {string} section - The G-code segment to add to the current line.
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public put(section: string, options?: CommandOptions): Builder {
    if (section.trim().length > 0) {
      this._diagnostics.push({
        file: this.currentFile.name,
        command: section,
        event: this.currentEvent?.name as string | undefined,
        eventIndex:
          this.currentEventIndex >= 0 ? this.currentEventIndex : undefined,
        listenerIndex: this.currentEventListenerIndex,
        reason: options?.reason,
      });
    }
    this.currentFile.put(
      section,
      options?.skipNewLine,
      options?.preserveWhitespace,
    );
    if (!options?.skipNewLine) {
      this.currentFile.flush();
    }

    return this;
  }

  /**
   * @method driver
   * @description Gets a typed controller driver API, creating and caching it on first use.
   */
  public driver<Api extends object>(driver: BuilderDriver<Api>): Api {
    const existing = this._drivers.get(driver.id);
    if (existing) {
      return existing as Api;
    }

    this._driverCapabilities.set(driver.id, new Set(driver.capabilities ?? []));
    const api = driver.create(this);
    this._drivers.set(driver.id, api);
    return api;
  }

  public driverSupports(driverId: string, capability: string): boolean {
    return this._driverCapabilities.get(driverId)?.has(capability) ?? false;
  }

  public requireDriverCapability(driverId: string, capability: string): void {
    if (!this.driverSupports(driverId, capability)) {
      throw new Error(
        `Driver '${driverId}' does not support capability '${capability}'.`,
      );
    }
  }

  public diagnostics(): readonly EmissionDiagnostic[] {
    return this._diagnostics;
  }

  public explain(filter: { file?: string; event?: string } = {}): string {
    return this._diagnostics
      .filter(
        (item) =>
          (filter.file === undefined || item.file === filter.file) &&
          (filter.event === undefined || item.event === filter.event),
      )
      .map((item) => {
        const source = item.event
          ? `${item.event}#${item.eventIndex ?? '?'} listener ${item.listenerIndex}`
          : 'manual emission';
        const reason = item.reason ? `: ${item.reason}` : '';
        return `${item.file} | ${item.command} | ${source}${reason}`;
      })
      .join('\n');
  }

  /**
   * @method Block
   * @description Emits a complete block from typed G-code words.
   */
  public Block(
    words: Array<GCodeWord | string | false | null | undefined>,
    options?: CommandOptions,
  ): Builder {
    const line = words
      .filter((word): word is GCodeWord | string => Boolean(word))
      .map((word) => (typeof word === 'string' ? word : this.formatWord(word)))
      .join(' ');

    return this.put(line, options);
  }

  /**
   * @method Word
   * @description Emits one typed G-code word such as X10, F1000, or D1.
   */
  public Word(
    letter: GCodeWordLetter,
    value: string | number,
    options?: CommandOptions,
  ): Builder {
    return this.put(this.formatWord({ letter, value }), options);
  }

  /**
   * @method G
   * @description Emits a G-word.
   */
  public G(code: string | number, options?: CommandOptions): Builder {
    return this.Word('G', code, options);
  }

  /**
   * @method M
   * @description Emits an M-word.
   */
  public M(code: string | number, options?: CommandOptions): Builder {
    return this.Word('M', code, options);
  }

  /**
   * @method CoolantOn
   * @description Emits M8.
   */
  public CoolantOn(options?: CommandOptions): Builder {
    return this.M(8, options);
  }

  /**
   * @method CoolantOff
   * @description Emits M9.
   */
  public CoolantOff(options?: CommandOptions): Builder {
    return this.M(9, options);
  }

  /**
   * @method SpindleStop
   * @description Emits M5.
   */
  public SpindleStop(options?: CommandOptions): Builder {
    return this.M(5, options);
  }

  /**
   * @method ProgramEndAndRewind
   * @description Emits M30.
   */
  public ProgramEndAndRewind(options?: CommandOptions): Builder {
    return this.M(30, options);
  }

  /**
   * @method flush
   * @description Finalizes the current G-code line in the current file. If the `_currentLine` buffer contains any words,
   * it prepends the line number (N-word), joins the words with spaces, trims whitespace,
   * adds it to the `_lines` array, clears the `_currentLine` buffer, and increments the `_lineNumber`.
   */
  public flush(): Builder {
    this.currentFile.flush();
    return this;
  }

  /**
   * @method BlankLine
   * @description Adds an unnumbered blank line to the current file.
   */
  public BlankLine(): Builder {
    this.currentFile.blankLine();
    return this;
  }

  /**
   * @method NumberedBlankLine
   * @description Adds a numbered empty line to the current file.
   */
  public NumberedBlankLine(): Builder {
    this.currentFile.numberedBlankLine();
    return this;
  }

  /**
   * @method nextLineNumberPrefix
   * @description Returns and advances the shared line-number prefix.
   */
  public nextLineNumberPrefix(): string {
    if (!this._options.numbering.enabled) {
      return '';
    }

    const prefix = `N${parseInt(this._currentLineNumber.toString(), 10)} `;
    this._currentLineNumber += this._options.numbering.increment;
    return prefix;
  }

  /**
   * @method OpenFile
   * @description Creates a new file with the given name.
   * @param {string} name - The name of the new file.
   * @param {MPF | SPF} extension - The extension of the new file, some times user may want to create a new MPF file, defaulted to SPF.
   * @param {append | replace} mode - Wether to replace the file with new coming data or just append them.
   * @throws {Error} If the builder is currently in a file.
   */
  public OpenFile(
    name: string,
    extension: 'MPF' | 'SPF' = 'SPF',
    mode: 'append' | 'replace' = 'append',
  ): Builder {
    const newFileName = `${name}.${extension}`;
    // If builder is not currently in the main file, throw and error as its only possible to create new files in the main file
    if (this.currentFile !== this.mainFile) {
      if (this.currentFile.name === newFileName) {
        if (mode === 'replace') {
          this.currentFile.clear();
        }
      } else {
        throw new Error(
          `Cannot create new files in non-main (MPF) files, you are currently in file ${this.currentFile.name}`,
        );
      }
    }

    const existingFile = this._files.find((file) => file.name === newFileName);
    if (!existingFile) {
      this._files.push(new File(this, `${name}.${extension}`));
      this.currentFile = this._files[this._files.length - 1];
    } else {
      if (mode === 'replace') {
        existingFile.clear();
      }
      this.currentFile = existingFile;
    }

    return this;
  }

  /**
   * @method CloseFile
   * @description Ends the current file.
   * @throws {Error} If the builder is currently in the main file.
   */
  public CloseFile(): Builder {
    // If builder is currently in the main file, throw and error as its only possible to end the main file
    if (this.currentFile === this.mainFile) {
      throw new Error('Cannot end the main (MPF) file');
    }

    this.currentFile = this.mainFile;

    return this;
  }

  /**
   * @method Comment
   * @description Generate Comments in G-code.
   * @param {string} text - The text to be commented.
   */
  public Comment(text: string, options?: CommandOptions): Builder {
    this.put(`; ${text}`, options);
    return this;
  }

  /**
   * @method OptionalStop
   * @description Generates G-code for optional stop (M1).
   */
  public OptionalStop(options?: CommandOptions): Builder {
    this.put('M1', options);
    return this;
  }

  /**
   * @method ProgramEnd
   * @description Generates G-code for program end (M1).
   */
  public ProgramEnd(options?: CommandOptions): Builder {
    this.put('M2', options);
    return this;
  }

  /**
   * @method Call
   * @description Generates G-code to call a file (SPF).
   * @param {string} name - The name of the file to call.
   */
  public Call(params: CommandsType['Call'], options?: CommandOptions): Builder {
    this.put(`CALL "${params}"`, options);
    return this;
  }

  /**
   * @method ExtCall
   * @description Generates G-code to call a file (SPF) from an external source (e.g., a USB drive).
   * @param {string} name - The name of the file to call.
   */
  public ExtCall(
    params: CommandsType['ExtCall'],
    options?: CommandOptions,
  ): Builder {
    this.put(`EXTCALL "${params}"`, options);
    return this;
  }

  /**
   * @method Rapid
   * @description Generates G-code for a rapid positioning move (typically G00).
   * It sets the machine's motion mode to rapid and then sets the target position.
   * @param {CommandsType['Rapid']} params - An object containing the target coordinates (e.g., { x, y, z }).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   * @example 'G0 X100 Y50 Z10'
   */
  public Rapid(
    params: CommandsType['Rapid'],
    options?: CommandOptions,
  ): Builder {
    this.put(this._machine.setMotionMode(0, options?.forcePrint), {
      skipNewLine: options?.skipNewLine ?? true,
      forcePrint: options?.forcePrint,
    });
    this.put(this._machine.setPosition(params, options?.forcePrint), options);

    return this;
  }

  /**
   * @method RapidResolved
   * @description Generates a rapid move for coordinates already filtered by the post.
   */
  public RapidResolved(
    params: CommandsType['Rapid'],
    options?: CommandOptions,
  ): Builder {
    this.put(this._machine.setMotionMode(0, options?.forcePrint), {
      skipNewLine: options?.skipNewLine ?? true,
      forcePrint: options?.forcePrint,
    });
    this.put(this._machine.setPosition(params, true), options);

    return this;
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
  public Line(params: CommandsType['Line'], options?: CommandOptions): Builder {
    this.put(this._machine.setMotionMode(1, options?.forcePrint), {
      skipNewLine: options?.skipNewLine ?? true,
      forcePrint: options?.forcePrint,
    });
    this.put(this._machine.setPosition(params, options?.forcePrint), options);

    return this;
  }

  /**
   * @method LineResolved
   * @description Generates a linear move for coordinates already filtered by the post.
   */
  public LineResolved(
    params: CommandsType['Line'],
    options?: CommandOptions,
  ): Builder {
    this.put(this._machine.setMotionMode(1, options?.forcePrint), {
      skipNewLine: options?.skipNewLine ?? true,
      forcePrint: options?.forcePrint,
    });
    this.put(this._machine.setPosition(params, true), options);

    return this;
  }

  /**
   * Generates a clockwise or counter-clockwise circular move for coordinates
   * already filtered by the post.
   */
  public CircularResolved(
    direction: 2 | 3,
    params: CommandsType['Line'],
    options?: CommandOptions,
  ): Builder {
    this.put(this._machine.setMotionMode(direction, options?.forcePrint), {
      skipNewLine: true,
      forcePrint: options?.forcePrint,
    });
    this.put(this._machine.setPosition(params, true), options);

    return this;
  }

  /**
   * @method LineWithFeedRateMode
   * @description Generates a linear move with feed-rate mode emitted before axis words.
   */
  public LineWithFeedRateMode(
    params: CommandsType['Line'],
    mode: 94 | 95,
    options?: CommandOptions,
  ): Builder {
    this.put(this._machine.setMotionMode(1, options?.forcePrint), {
      skipNewLine: true,
      forcePrint: options?.forcePrint,
    });
    this.put(this._machine.setFeedRateMode(mode, true), {
      skipNewLine: true,
      forcePrint: true,
    });
    this.put(this._machine.setPosition(params, true), options);

    return this;
  }

  /**
   * @method LineWithModalWords
   * @description Generates a linear move with additional modal words emitted before axis words.
   */
  public LineWithModalWords(
    params: CommandsType['Line'],
    words: string[],
    options?: CommandOptions,
  ): Builder {
    this.put(this._machine.setMotionMode(1, options?.forcePrint), {
      skipNewLine: true,
      forcePrint: options?.forcePrint,
    });
    for (const word of words) {
      this.put(word, { skipNewLine: true });
    }
    this.put(this._machine.setPosition(params, true), options);

    return this;
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
  ): Builder {
    this.put(
      this._machine.setMachinePlane(plane, options?.forcePrint),
      options,
    );
    return this;
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
  ): Builder {
    this.put(
      this._machine.setSpindleSpeed(speed, options?.forcePrint),
      options,
    );
    return this;
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
  ): Builder {
    this.put(
      this._machine.setSpindleDirection(direction, options?.forcePrint),
      options,
    );
    return this;
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
  ): Builder {
    this.put(this._machine.setFeedRate(feedRate, options?.forcePrint), options);
    return this;
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
  ): Builder {
    this.put(
      this._machine.selectTool(toolNumber, options?.forcePrint),
      options,
    );
    return this;
  }

  /**
   * @method ChangeTool
   * @description Generates G-code to change the tool (M6).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public ChangeTool(options?: CommandOptions): Builder {
    this.put('M6', options);
    return this;
  }

  /**
   * @method UseMillimeters
   * @description Generates G-code to set the machine to use millimeters (G710).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public UseMillimeters(options?: CommandOptions): Builder {
    this.put(this._machine.setUnitSystem(710, options?.forcePrint), options);
    return this;
  }

  /**
   * @method UseInches
   * @description Generates G-code to set the machine to use inches (G700).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public UseInches(options?: CommandOptions): Builder {
    this.put(this._machine.setUnitSystem(700, options?.forcePrint), options);
    return this;
  }

  /**
   * @method SetAbsoluteMode
   * @description Generates G-code to set the machine to absolute mode (G90).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetAbsoluteMode(options?: CommandOptions): Builder {
    this.put(
      this._machine.setPositioningMode(90, options?.forcePrint),
      options,
    );
    return this;
  }

  /**
   * @method SetIncrementalMode
   * @description Generates G-code to set the machine to incremental mode (G91).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetIncrementalMode(options?: CommandOptions): Builder {
    this.put(
      this._machine.setPositioningMode(91, options?.forcePrint),
      options,
    );
    return this;
  }

  /**
   * @method SetFeedRateMode
   * @description Generates G-code to set the feed rate mode (G94 or G95).
   * @param {94 | 95} mode - The desired feed rate mode (G94 or G95).
   * @param {CommandOptions} [options] - Optional settings for command generation.
   */
  public SetFeedRateMode(mode: 94 | 95, options?: CommandOptions): Builder {
    this.put(this._machine.setFeedRateMode(mode, options?.forcePrint), options);
    return this;
  }

  private formatWord(word: GCodeWord): string {
    return `${word.letter}${word.value}`;
  }

  /**
   * @interface BuilderExecutionOptions
   * @description Options for builder execution
   */
}
