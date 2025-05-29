import type { Event } from './program';

/**
 * @class Emitter
 * @template T - The type of the value being wrapped, typically string or number.
 * @description A utility class to wrap a value.
 * It only generates an output string (e.g., G-code segment) if the new value
 * is different from the current value, preventing redundant G-code.
 * It also handles prefixing the value (e.g., 'X' for X-coordinate).
 */
export class Emitter<T extends string | number> {
  /**
   * @private
   * @property _value
   * @description The current value of the wrapped parameter.
   */
  private _value: T | null = null;

  /**
   * @private
   * @property _prefix
   * @description The prefix for the wrapped parameter.
   */
  private _prefix: string;

  /**
   * @private
   * @property _transform
   * @description An optional function to transform the value before rendering.
   */
  private _transform?: (value: T) => string;

  /**
   * @private
   * @property _log
   * @description The log of events that this value has been used in.
   */
  private _log: {
    event: Event<any>;
    eventListenerIndex: number;
    previousValue: T | null;
    newValue?: T;
    forcePrint?: boolean;
    output: string;
  }[] = [];

  /**
   * @constructor
   * @param {string} prefix - The G-code prefix for this parameter (e.g., 'X', 'G', 'M', 'S').
   * @param {(value: T) => string} [transform] - An optional function to transform the value before rendering.
   */
  constructor(prefix: string, transform?: (value: T) => string) {
    this._prefix = prefix;
    this._transform = transform;
  }

  /**
   * @method render
   * @description Renders the G-code string for this parameter if the newValue is different from the current value.
   * If newValue is undefined, it returns an empty string.
   * @param {T} [newValue] - The new value for the parameter.
   * @param {boolean} [forcePrint] - If true, prints the value even if it hasn't changed.
   * @returns {string} The G-code string segment (e.g., "X100.0") or an empty string if the value hasn't changed or is undefined.
   */
  render(
    event: Event<any>,
    eventListenerIndex: number,
    newValue?: T,
    forcePrint?: boolean,
  ): string {
    if (newValue === undefined) {
      this._log.push({
        event,
        eventListenerIndex,
        previousValue: this._value,
        newValue,
        forcePrint,
        output: '',
      });
      return '';
    }

    if (!forcePrint && this._value === newValue) {
      this._log.push({
        event,
        eventListenerIndex,
        previousValue: this._value,
        newValue,
        forcePrint,
        output: '',
      });
      return '';
    }
    this._log.push({
      event,
      eventListenerIndex,
      previousValue: this._value,
      newValue,
      forcePrint,
      output: `${this._prefix}${
        this._transform ? this._transform(newValue) : newValue
      }`,
    });
    this._value = newValue;
    return `${this._prefix}${
      this._transform ? this._transform(newValue) : newValue
    }`;
  }

  /**
   * @property {T | null} value
   * @description Gets the current value of the wrapped parameter.
   * @readonly
   */
  public get value(): T | null {
    return this._value;
  }
}
