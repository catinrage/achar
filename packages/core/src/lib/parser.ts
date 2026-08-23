import { DirectionEnum, PlaneEnum, StateEnum } from '../common/enums';
import type { EventsType } from '../types';
import {
  createErrorContext,
  ErrorCollector,
  ParseError,
  wrapError,
} from './errors';
import { createLogger, LogLevel, measurePerformance } from './logger';
import { assert, InputValidators, Validator } from './validation';

/**
 * @interface EventData
 * @template T - A key of EventsType, representing the specific event name.
 * @description Represents the structured data of a single parsed event.
 * It includes the event name (`_eventName`), a parser-assigned index (`_index`),
 * and any other key-value parameters associated with the event.
 */
export interface EventData<T extends keyof EventsType = keyof EventsType> {
  /**
   * @property _eventName
   * @description The name of the event, converted to PascalCase (e.g., from 'start_of_file' to 'StartOfFile').
   */
  _eventName: T;
  /**
   * @property _index
   * @description A zero-based index assigned by the parser during processing, indicating the order of events as parsed.
   */
  _index: number;
  /** Trace nesting level. Levels above 1 are normally internal GPP callbacks. */
  _depth?: number;
  /**
   * @property [key: string]
   * @description Additional dynamic properties of the event, parsed as key-value pairs from the input.
   * Values can be strings, numbers, or booleans based on parsing logic.
   */
  [key: string]: string | number | boolean | undefined;
}

const traceChangeSuffix = /[TF]$/;

/** Matches an event declaration such as `(0)@start_of_file` on a single line. */
const eventSectionPattern = /^\s*\((\d+)\)@(\w+)/;

/**
 * Multi-line variant of {@link eventSectionPattern} used to scan a whole trace
 * without splitting it into lines. `[^\S\n]*` is the leading-whitespace class
 * minus the newline, so `^` stays anchored to real line starts.
 */
const eventSectionScanPattern = /^[^\S\n]*\(\d+\)@(\w+)/gm;

/**
 * @function toPascalCase
 * @description Converts a snake_case trace token to the PascalCase event name
 * used throughout Achar (e.g. 'start_of_file' becomes 'StartOfFile').
 */
function toPascalCase(str: string): string {
  return str
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * @interface ParseOptions
 * @description Configuration options for parsing
 */
export interface ParseOptions {
  /**
   * Whether to continue parsing after encountering errors
   */
  continueOnError?: boolean;
  /**
   * Whether to validate parsed data
   */
  validateParsedData?: boolean;
  /**
   * Maximum number of errors to collect before stopping
   */
  maxErrors?: number;
  /**
   * Log level for parsing operations
   */
  logLevel: LogLevel;
}

/**
 * @interface ParseResult
 * @description Result of parsing operation
 */
export interface ParseResult {
  /**
   * Parsed events
   */
  events: EventData[];
  /**
   * Collected errors during parsing
   */
  errors: ParseError[];
  /**
   * Parsing statistics
   */
  statistics: {
    totalLines: number;
    parsedEvents: number;
    skippedLines: number;
    errorCount: number;
    warningCount: number;
    processingTime: number;
  };
}

/**
 * @class Parser
 * @description Parses a multi-line string input, expected to follow a specific format
 * (e.g., SolidCAM trace mode 5 output), into an array of structured `EventData` objects.
 * It identifies event blocks, extracts their names and parameters, and attempts to convert
 * parameter values to appropriate types (string, number, boolean, or known enums).
 */
export class Parser {
  /**
   * @private
   * @property _input
   * @description The multi-line string input that the parser will process.
   */
  private readonly _input: string;

  /**
   * @private
   * @property _options
   * @description Parsing options
   */
  private readonly _options: ParseOptions;

  /**
   * @private
   * @property _logger
   * @description Logger instance for this parser
   */
  private _logger = createLogger('Parser');

  /**
   * @private
   * @property _errorCollector
   * @description Error collector for gathering parsing errors
   */
  private _errorCollector = new ErrorCollector();

  /**
   * @constructor
   * @param {string} input - The raw string data to be parsed.
   * @param {ParseOptions} options - Parsing options
   */
  constructor(input: string, options?: ParseOptions) {
    this._options = {
      continueOnError: true,
      validateParsedData: true,
      maxErrors: 100,
      logLevel: LogLevel.INFO,
      ...options,
    };

    this._logger.setLevel(this._options.logLevel);

    try {
      // Validate input
      InputValidators.validateFileInput(input, 'Parser');
      this._input = input;

      this._logger.info(
        'Parser initialized',
        {
          inputLength: input.length,
          options: this._options,
        },
        'constructor',
      );
    } catch (error) {
      const wrappedError = wrapError(error, 'Parser', 'constructor');
      this._logger.logError(wrappedError, 'constructor');
      throw wrappedError;
    }
  }

  /**
   * @public
   * @method parse
   * @description Parses the input string (provided in the constructor) line by line.
   * It identifies event declarations (e.g., "(0)@event_name") and subsequent lines
   * containing key-value parameters for that event.
   * Values are parsed and typed: strings (with surrounding single quotes removed),
   * booleans (`true` or `false`), numbers (with optional unit suffixes stripped),
   * or values matching `DirectionEnum`, `StateEnum`, or `PlanEnum`.
   * @returns {EventData[]} An array of `EventData` objects, each representing a parsed event
   * with its properties. The `_eventName` is in PascalCase and `_index` is parser-assigned.
   */
  public parse(): EventData[] {
    try {
      const result = this.parseWithOptions({
        ...this._options,
      });

      // If there are critical errors, throw them
      if (result.errors.length > 0) {
        const criticalErrors = result.errors.filter(
          (error) => error.severity === 'critical',
        );
        if (criticalErrors.length > 0) {
          throw criticalErrors[0];
        }
      }

      return result.events;
    } catch (error) {
      const wrappedError = wrapError(error, 'Parser', 'parse');
      this._logger.logError(wrappedError, 'parse');
      throw wrappedError;
    }
  }

  /**
   * @public
   * @method scanEventNames
   * @description Returns the distinct PascalCase event names present in the
   * input without building event objects, parsing values, or validating them.
   * This exists for callers that only need an event-name inventory (coverage
   * checks, tooling); on a multi-hundred-megabyte trace it is roughly two
   * orders of magnitude cheaper than {@link Parser.parse}, which allocates one
   * object per event and every parameter on it.
   *
   * It reads the same event-declaration syntax as `parse`, so the result is
   * always a subset of the `_eventName` values `parse` would report.
   * @returns {Set<string>} Distinct event names, in first-seen order.
   */
  public scanEventNames(): Set<string> {
    const names = new Set<string>();

    // A single sticky/global regex over the whole input avoids materializing
    // an array of millions of line strings.
    eventSectionScanPattern.lastIndex = 0;
    let match = eventSectionScanPattern.exec(this._input);
    while (match !== null) {
      names.add(toPascalCase(match[1]));
      match = eventSectionScanPattern.exec(this._input);
    }

    return names;
  }

  /**
   * @public
   * @method getErrors
   * @description Get all collected errors
   * @returns {AcharError[]} Array of collected errors
   */
  public getErrors(): ParseError[] {
    return this._errorCollector.getAll();
  }

  /**
   * @public
   * @method hasErrors
   * @description Check if parser has collected any errors
   * @returns {boolean} True if there are errors
   */
  public hasErrors(): boolean {
    return this._errorCollector.hasErrors();
  }

  /**
   * @public
   * @method clearErrors
   * @description Clear all collected errors
   */
  public clearErrors(): void {
    this._errorCollector.clear();
  }

  /**
   * @public
   * @method getErrorSummary
   * @description Get a summary of all collected errors
   * @returns {string} Error summary
   */
  public getErrorSummary(): string {
    return this._errorCollector.getSummary();
  }

  /**
   * @private
   * @method _validateEventData
   * @description Validates parsed event data
   * @param {EventData} event - The event data to validate
   * @param {number} lineNumber - The line number where the event was found
   */
  private _validateEventData(event: EventData, lineNumber: number): void {
    try {
      // Validate event name
      InputValidators.validateEventName(event._eventName, 'Parser');

      // Validate event parameters
      InputValidators.validateEventParameters(event, 'Parser');

      // Validate index
      assert(
        typeof event._index === 'number' && event._index >= 0,
        `Event index must be a non-negative number, got ${event._index}`,
        'Parser',
        '_validateEventData',
      );

      // Type-specific validation
      this._validateEventTypeSpecificData(event, lineNumber);
    } catch (error) {
      const parseError = new ParseError(
        `Event validation failed at line ${lineNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        createErrorContext(
          'Parser',
          '_validateEventData',
          {
            eventName: event._eventName,
            lineNumber,
            eventIndex: event._index,
          },
          error instanceof Error ? error : undefined,
        ),
      );

      this._errorCollector.add(parseError);
      this._logger.logError(parseError, '_validateEventData');

      if (!this._options.continueOnError) {
        throw parseError;
      }
    }
  }

  /**
   * @private
   * @method _validateEventTypeSpecificData
   * @description Validates event-specific data based on event type
   * @param {EventData} event - The event data to validate
   * @param {number} lineNumber - The line number where the event was found
   */
  private _validateEventTypeSpecificData(
    event: EventData,
    lineNumber: number,
  ): void {
    try {
      switch (event._eventName) {
        case 'ToolChange':
          if (typeof event.tool_number === 'number') {
            InputValidators.validateToolNumber(event.tool_number, 'Parser');
          }
          break;

        case 'Line':
          ['x', 'y', 'z', 'a', 'b', 'c'].forEach((axis) => {
            if (typeof event[axis] === 'number') {
              InputValidators.validateCoordinate(
                event[axis] as number,
                axis,
                'Parser',
              );
            }
          });
          break;

        case 'MachinePlane':
          if (typeof event.machine_plane === 'string') {
            const validator = new Validator();
            validator.addRule({
              validate: (value: unknown) =>
                typeof value === 'string' &&
                Object.values(PlaneEnum).includes(value as PlaneEnum),
              message: `Invalid machine plane: ${event.machine_plane}`,
              code: 'INVALID_PLANE',
            });
            if (
              !validator.validate(event.machine_plane, {
                component: 'Parser',
                operation: '_validateEventTypeSpecificData',
              })
            ) {
              throw new Error(`Invalid machine plane: ${event.machine_plane}`);
            }
          }
          break;

        default:
          // For unknown event types, just log a warning
          this._logger.warn(
            `Unknown event type for validation: ${event._eventName}`,
            {
              eventName: event._eventName,
              lineNumber,
            },
            '_validateEventTypeSpecificData',
          );
      }
    } catch (error) {
      const parseError = new ParseError(
        `Event type-specific validation failed for ${
          event._eventName
        } at line ${lineNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        createErrorContext(
          'Parser',
          '_validateEventTypeSpecificData',
          {
            eventName: event._eventName,
            lineNumber,
            eventIndex: event._index,
          },
          error instanceof Error ? error : undefined,
        ),
      );

      this._errorCollector.add(parseError);
      this._logger.logError(parseError, '_validateEventTypeSpecificData');

      if (!this._options.continueOnError) {
        throw parseError;
      }
    }
  }

  /**
   * @private
   * @method _parseValue
   * @description Safely parse a value with proper error handling
   * @param {string} value - The value to parse
   * @param {string} key - The key associated with the value
   * @param {number} lineNumber - The line number being parsed
   * @returns {string | number | boolean} The parsed value
   */
  private _parseValue(
    value: string,
    key: string,
    lineNumber: number,
  ): string | number | boolean {
    try {
      // Remove surrounding quotes if present
      if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1);
      }

      // Parse boolean values
      if (value === 'true' || value === 'false') {
        return value === 'true';
      }

      // Parse numeric values
      const numericValue = value.replace(/[A-Za-z]+$/, '');
      if (!Number.isNaN(parseFloat(numericValue))) {
        const parsedNumber = Number(numericValue);

        // Validate the parsed number
        if (!Number.isFinite(parsedNumber)) {
          throw new Error(`Parsed number is not finite: ${parsedNumber}`);
        }

        return parsedNumber;
      }

      // Check for enum values
      if (Object.values(DirectionEnum).includes(value as DirectionEnum)) {
        return value;
      }

      if (Object.values(StateEnum).includes(value as StateEnum)) {
        return value;
      }

      if (Object.values(PlaneEnum).includes(value as PlaneEnum)) {
        return value;
      }

      // Return as string if no other type matches
      return value;
    } catch (error) {
      const parseError = new ParseError(
        `Failed to parse value '${value}' for key '${key}' at line ${lineNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        createErrorContext(
          'Parser',
          '_parseValue',
          {
            value,
            key,
            lineNumber,
          },
          error instanceof Error ? error : undefined,
        ),
        { recoverable: true, strategy: 'default', defaultValue: value },
      );

      this._errorCollector.add(parseError);
      this._logger.logError(parseError, '_parseValue');

      if (!this._options.continueOnError) {
        throw parseError;
      }

      // Return original value as fallback
      return value;
    }
  }

  /**
   * @public
   * @method parse
   * @description Enhanced parse method with comprehensive error handling
   * @param {ParseOptions} options - Override parsing options
   * @returns {ParseResult} Enhanced parsing result with statistics and errors
   */
  public parseWithOptions(options?: ParseOptions): ParseResult {
    const mergedOptions = { ...this._options, ...options };
    const startTime = performance.now();

    this._logger.info(
      'Starting parsing operation',
      {
        inputLength: this._input.length,
        options: mergedOptions,
      },
      'parseWithOptions',
    );

    return measurePerformance(
      'parse',
      () => {
        const lines = this._input.split('\n');
        const events: EventData[] = [];
        let currentEvent: EventData | null = null;
        let lastDrillEvent: EventData<'Drill'> | null = null;
        let indexCounter = 0;
        let skippedLines = 0;
        let warningCount = 0;

        lines.forEach((line, lineIndex) => {
          try {
            const lineNumber = lineIndex + 1;

            if (lineNumber % 100 === 0) {
              this._logger.debug(
                `Processing line ${lineNumber}/${lines.length}`,
                {
                  progress: `${((lineNumber / lines.length) * 100).toFixed(1)}%`,
                },
                'parseWithOptions',
              );
            }

            // Check for event section
            const sectionMatch = line.match(eventSectionPattern);
            if (sectionMatch) {
              // Save previous event if exists
              if (currentEvent) {
                if (mergedOptions.validateParsedData) {
                  this._validateEventData(currentEvent, lineNumber);
                }
                events.push(currentEvent);
              }

              // Start new event
              const eventName = toPascalCase(
                sectionMatch[2],
              ) as keyof EventsType;
              currentEvent = {
                _eventName: eventName,
                _index: indexCounter,
                _depth: Number(sectionMatch[1]),
              };
              if (eventName === 'Drill') {
                lastDrillEvent = currentEvent as EventData<'Drill'>;
              }
              indexCounter++;

              this._logger.debug(
                `Found event: ${eventName} at line ${lineNumber}`,
                {
                  eventName,
                  eventIndex: indexCounter - 1,
                  lineNumber,
                },
                'parseWithOptions',
              );
            }

            const cycleArguments = line.match(
              /\bCYCLE(?:81|83|84|85|830)\(([^)]*)\)/,
            )?.[1];
            if (lastDrillEvent && cycleArguments !== undefined) {
              const args = cycleArguments.split(',');
              const clearance = Number(args[0]);
              const upper = Number(args[1]);
              const lower = Number(args[3]);
              if (Number.isFinite(clearance)) {
                lastDrillEvent.cycle_clearance_z_precise ??= clearance;
              }
              if (Number.isFinite(upper)) {
                lastDrillEvent.cycle_upper_z_precise ??= upper;
              }
              if (Number.isFinite(lower)) {
                lastDrillEvent.cycle_lower_z_precise ??= lower;
              }
            }

            // Parse key-value pairs
            if (currentEvent) {
              const event = currentEvent;
              const keyValueMatch = line.match(
                /([\w_]+)\s?:\s?'([^']*)'|([\w_]+)\s?:\s?([^\s]+)/g,
              );

              if (keyValueMatch) {
                keyValueMatch.forEach((pair) => {
                  try {
                    const splitIndex = pair.indexOf(':');
                    const key = pair.substring(0, splitIndex).trim();
                    const rawValue = pair.substring(splitIndex + 1).trim();

                    const parsedValue = this._parseValue(
                      rawValue,
                      key,
                      lineNumber,
                    );
                    event[key] = parsedValue;
                    if (traceChangeSuffix.test(rawValue)) {
                      event[`${key}__changed`] = rawValue.endsWith('T');
                    }
                  } catch (error) {
                    warningCount++;
                    this._logger.warn(
                      `Failed to parse key-value pair: ${pair}`,
                      {
                        line: lineNumber,
                        pair,
                        error:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      },
                      'parseWithOptions',
                    );

                    if (!mergedOptions.continueOnError) {
                      throw error;
                    }
                  }
                });
              }

              const wearMessage = line.match(
                /\bsWCM_MSG\s*:\s*(.*?)(?=\s+iM1\s*:|$)/,
              )?.[1];
              if (wearMessage !== undefined) {
                event.sWCM_MSG = wearMessage.trim();
              }

              const toolChangeMessage = line.match(
                /\bsM1_MSG\s*:\s*(.*?)(?=\s+iTC_SUPA_MODE\s*:|$)/,
              )?.[1];
              if (toolChangeMessage !== undefined) {
                event.sM1_MSG = toolChangeMessage.trim();
              }
            }

            // Check if we should stop due to too many errors
            if (
              this._errorCollector.getAll().length >=
              (mergedOptions.maxErrors || 100)
            ) {
              this._logger.error(
                `Maximum error count reached (${mergedOptions.maxErrors}), stopping parsing`,
                undefined,
                {
                  errorCount: this._errorCollector.getAll().length,
                  lineNumber,
                },
                'parseWithOptions',
              );
              return; // Return instead of break to exit the forEach
            }
          } catch (error) {
            skippedLines++;

            const parseError = new ParseError(
              `Failed to parse line ${lineIndex + 1}: ${
                error instanceof Error ? error.message : String(error)
              }`,
              createErrorContext(
                'Parser',
                'parseWithOptions',
                {
                  lineNumber: lineIndex + 1,
                  lineContent: line,
                },
                error instanceof Error ? error : undefined,
              ),
            );

            this._errorCollector.add(parseError);
            this._logger.logError(parseError, 'parseWithOptions');

            if (!mergedOptions.continueOnError) {
              throw parseError;
            }
          }
        });

        // Process final event
        const finalEvent = currentEvent as EventData | null;
        if (finalEvent) {
          try {
            if (mergedOptions.validateParsedData) {
              this._validateEventData(finalEvent, lines.length);
            }
            events.push(finalEvent);
          } catch (error) {
            this._logger.error(
              `Failed to validate final event: ${
                error instanceof Error ? error.message : String(error)
              }`,
              error instanceof Error ? error : undefined,
              {
                eventName: finalEvent._eventName,
                eventIndex: finalEvent._index,
              },
              'parseWithOptions',
            );

            if (!mergedOptions.continueOnError) {
              throw error;
            }
          }
        }

        const endTime = performance.now();
        const processingTime = endTime - startTime;

        const result: ParseResult = {
          events,
          errors: this._errorCollector.getAll(),
          statistics: {
            totalLines: lines.length,
            parsedEvents: events.length,
            skippedLines,
            errorCount: this._errorCollector.getAll().length,
            warningCount,
            processingTime,
          },
        };

        this._logger.info(
          'Parsing completed',
          result.statistics,
          'parseWithOptions',
        );

        return result;
      },
      this._logger,
    );
  }
}
