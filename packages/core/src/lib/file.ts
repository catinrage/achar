import type { DeepPartial } from '../types';
import type { Builder, BuilderOptions } from './builder';
import {
  BuilderError,
  createErrorContext,
  ErrorCollector,
  wrapError,
} from './errors';
import { createLogger } from './logger';
import { assert, InputValidators } from './validation';

export interface FileOptions {
  numbering: BuilderOptions['numbering'];
}

export class File {
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
   * @property _builder
   * @description Builder that owns this file and, by default, owns line numbering.
   */
  private readonly _builder: Builder;

  /**
   * @private
   * @property _useBuilderNumbering
   * @description Whether this file consumes the builder's shared line-number sequence.
   */
  private readonly _useBuilderNumbering: boolean;

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

  private _preserveCurrentLineWhitespace = false;

  /**
   * @private
   * @property _currentLineNumber
   * @description The current G-code line number (N-word). It increments by a fixed step after flushing the current line (e.g., 10).
   */
  private _currentLineNumber = 10;

  /**
   * @private
   * @property _logger
   * @description Logger instance for this file
   */
  private _logger = createLogger('File');

  /**
   * @private
   * @property _errorCollector
   * @description Error collector for file operations
   */
  private _errorCollector = new ErrorCollector();

  /**
   * @constructor
   * @description Initializes a new File instance.
   * @param {Builder} builder - The builder instance.
   * @param {string} name - The name of the file.
   * @param {string} type - The type of the file.
   * @param {DeepPartial<FileOptions>} [options] - Optional settings for the file.
   */
  constructor(
    builder: Builder,
    name: string,
    type: 'Main' | 'Sub' = 'Sub',
    options?: DeepPartial<FileOptions>,
  ) {
    try {
      // Validate inputs
      assert(
        builder !== null && builder !== undefined,
        'Builder instance is required',
        'File',
        'constructor',
      );
      InputValidators.validateFileInput(name, 'File');

      this._builder = builder;
      this._useBuilderNumbering = options?.numbering === undefined;
      this.name = name;
      this.type = type;
      this._options = {
        numbering: {
          enabled:
            options?.numbering?.enabled ?? this._options.numbering.enabled,
          start: options?.numbering?.start ?? this._options.numbering.start,
          increment:
            options?.numbering?.increment ?? this._options.numbering.increment,
        },
      };

      // Validate numbering options
      InputValidators.validateLineNumberOptions(
        this._options.numbering,
        'File',
      );

      this._currentLineNumber = this._options.numbering.start;

      this._logger.info(
        `File ${name} created`,
        {
          fileName: name,
          fileType: type,
          options: this._options,
        },
        'constructor',
      );
    } catch (error) {
      const wrappedError = wrapError(error, 'File', 'constructor');
      this._logger.logError(wrappedError, 'constructor');
      throw wrappedError;
    }
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
   * @description The type of the file (.mpf or .spf).
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
  public put(
    section: string,
    skipNewLine?: boolean,
    preserveWhitespace = false,
  ): File {
    try {
      // Validate input
      if (section !== null && section !== undefined) {
        // Basic validation for G-code sections
        const normalizedSection = preserveWhitespace ? section : section.trim();
        if (normalizedSection.trim().length > 0) {
          // this._validateGCodeSection(trimmedSection);
          this._currentLine.push(normalizedSection);
          this._preserveCurrentLineWhitespace ||= preserveWhitespace;

          this._logger.debug(
            `Added section to current line`,
            {
              section: normalizedSection,
              currentLineLength: this._currentLine.length,
              skipNewLine,
            },
            'put',
          );
        }
      }

      // Flush if not skipping new line
      if (!skipNewLine) {
        this.flush();
      }
    } catch (error) {
      const builderError = new BuilderError(
        `Failed to add section to file ${this.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        createErrorContext(
          'File',
          'put',
          {
            fileName: this.name,
            section,
            currentLineLength: this._currentLine.length,
          },
          error instanceof Error ? error : undefined,
        ),
      );

      this._errorCollector.add(builderError);
      this._logger.logError(builderError, 'put');
      throw builderError;
    }

    return this;
  }

  /**
   * @method flush
   * @description Finalizes the current G-code line. If the `_currentLine` buffer contains any words,
   * it prepends the line number (N-word), joins the words with spaces, trims whitespace,
   * adds it to the `_lines` array, clears the `_currentLine` buffer, and increments the `_lineNumber`.
   */
  public flush(): File {
    if (this._currentLine.length > 0 && this._currentLine.join('').length > 0) {
      const line = this._currentLine.join(' ');
      this._lines.push(
        this._lineNumberPrefix() +
          (this._preserveCurrentLineWhitespace ? line : line.trim()),
      );
      this._currentLine = [];
      this._preserveCurrentLineWhitespace = false;
    }

    return this;
  }

  /**
   * @method blankLine
   * @description Adds an unnumbered blank line, flushing pending content first.
   */
  public blankLine(): File {
    this.flush();
    this._lines.push('');
    return this;
  }

  /** Removes one trailing blank line before appending another program section. */
  public removeTrailingBlankLine(): File {
    this.flush();
    if (this._lines.at(-1) === '') {
      this._lines.pop();
    }
    return this;
  }

  /**
   * @method numberedBlankLine
   * @description Adds a numbered empty line, consuming one line number.
   */
  public numberedBlankLine(): File {
    this.flush();
    this._lines.push(this._lineNumberPrefix());
    return this;
  }

  /**
   * @method clear
   * @description Clears the line for the new file, making it empty.
   */
  public clear(): File {
    this._lines = [];
    this._currentLine = [];
    this._preserveCurrentLineWhitespace = false;
    return this;
  }

  private _lineNumberPrefix(): string {
    if (this._useBuilderNumbering) {
      return this._builder.nextLineNumberPrefix();
    }

    if (!this._options.numbering.enabled) {
      return '';
    }

    const prefix = `N${parseInt(this._currentLineNumber.toString(), 10)} `;
    this._currentLineNumber += this._options.numbering.increment;
    return prefix;
  }
}
