import { DirectionEnum, StateEnum, PlanEnum } from '$src/common/enums';
import type { EventsType } from '$src/types';

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
  /**
   * @property [key: string]
   * @description Additional dynamic properties of the event, parsed as key-value pairs from the input.
   * Values can be strings, numbers, or booleans based on parsing logic.
   */
  [key: string]: string | number | boolean | undefined;
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
  private _input: string;

  /**
   * @constructor
   * @param {string} input - The raw string data to be parsed.
   */
  constructor(input: string) {
    this._input = input;
  }

  /**
   * @private
   * @method _toPascalCase
   * @description Helper function to convert a snake_case string to PascalCase.
   * For instance, 'example_event_name' would become 'ExampleEventName'.
   * @param {string} str - The snake_case string to be converted.
   * @returns {string} The string converted to PascalCase.
   */
  private _toPascalCase(str: string): string {
    return str
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
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
    const lines = this._input.split('\n');
    const jsonObject: any[] = [];
    let currentEvent: any = null;

    let indexCounter = 0;

    lines.forEach((line) => {
      const sectionMatch = line.match(/^\s*\((\d+)\)@(\w+)/);
      if (sectionMatch) {
        if (currentEvent) jsonObject.push(currentEvent); // Save the previous event
        currentEvent = {
          _eventName: this._toPascalCase(sectionMatch[2]),
          _index: indexCounter,
        };
        indexCounter++;
      }

      if (currentEvent) {
        const keyValueMatch = line.match(
          /([\w_]+)\s?:\s?'([^']*)'|([\w_]+)\s?:\s?([^\s]+)/g,
        );
        if (keyValueMatch) {
          keyValueMatch.forEach((pair) => {
            // Split by ':' only if it's outside of single quotes
            const splitIndex = pair.indexOf(':');
            const key = pair.substring(0, splitIndex).trim();
            const value = pair.substring(splitIndex + 1).trim();

            if (value.startsWith("'") && value.endsWith("'")) {
              // Treat as a string by removing quotes
              currentEvent[key] = value.slice(1, -1);
            } else if (value === 'true' || value === 'false') {
              // Treat as a boolean
              currentEvent[key] = value === 'true';
            } else if (!isNaN(parseFloat(value.replace(/[A-Za-z]+$/, '')))) {
              // Treat as a number by stripping non-numeric suffix
              currentEvent[key] = Number(value.replace(/[A-Za-z]+$/, ''));
            } else if (
              Object.values(DirectionEnum).includes(value as DirectionEnum)
            ) {
              // Handle direction-related enums
              currentEvent[key] = value;
            } else if (Object.values(StateEnum).includes(value as StateEnum)) {
              // Handle state-related enums
              currentEvent[key] = value;
            } else if (Object.values(PlanEnum).includes(value as PlanEnum)) {
              // Handle plane-related enums
              currentEvent[key] = value;
            } else {
              // If it doesn't match, keep as is (edge case)
              currentEvent[key] = value;
            }
          });
        }
      }
    });

    if (currentEvent) jsonObject.push(currentEvent); // Save the last event

    return jsonObject;
  }
}
