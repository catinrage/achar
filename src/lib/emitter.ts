/**
 * @class Emitter
 * @template T - The type of the value being wrapped, typically string or number.
 * @description A utility class to wrap a value.
 * It only generates an output string (e.g., G-code segment) if the new value
 * is different from the current value, preventing redundant G-code.
 * It also handles prefixing the value (e.g., 'X' for X-coordinate).
 */
export class Emitter<T extends string | number> {
  private _value: T | null = null;
  private _prefix: string;
  private _transform?: (value: T) => string;

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
  render(newValue?: T, forcePrint?: boolean): string {
    if (newValue === undefined) {
      return '';
    }

    if (!forcePrint && this._value === newValue) {
      return '';
    }
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
