/**
 * @file validation.ts
 * @description Validation utilities for input validation and data integrity checks
 */

import { createErrorContext, ValidationError } from './errors';

/**
 * @interface ValidationRule
 * @description Defines a validation rule
 */
export interface ValidationRule<T = unknown> {
  /**
   * The validation function
   */
  validate: (value: T) => boolean;
  /**
   * Error message when validation fails
   */
  message: string;
  /**
   * Optional error code
   */
  code?: string;
}

/**
 * @interface ValidatorOptions
 * @description Options for validators
 */
export interface ValidatorOptions {
  /**
   * Whether to continue validation after first error
   */
  stopOnFirstError?: boolean;
  /**
   * Component name for error context
   */
  component?: string;
  /**
   * Operation name for error context
   */
  operation?: string;
}

/**
 * @class Validator
 * @description Utility class for input validation
 */
export class Validator {
  private rules: ValidationRule[] = [];
  private errors: ValidationError[] = [];

  /**
   * Add a validation rule
   */
  addRule<T>(rule: ValidationRule<T>): this {
    this.rules.push(rule as ValidationRule);
    return this;
  }

  /**
   * Validate a value against all rules
   */
  validate(value: unknown, options: ValidatorOptions = {}): boolean {
    this.errors = [];
    const { stopOnFirstError = false, component, operation } = options;

    for (const rule of this.rules) {
      if (!rule.validate(value)) {
        const context = createErrorContext(component, operation, {
          value,
          rule: rule.message,
        });

        this.errors.push(
          new ValidationError(rule.message, context, {
            recoverable: true,
            strategy: 'default',
          }),
        );

        if (stopOnFirstError) {
          break;
        }
      }
    }

    return this.errors.length === 0;
  }

  /**
   * Get validation errors
   */
  getErrors(): ValidationError[] {
    return [...this.errors];
  }

  /**
   * Clear all rules and errors
   */
  clear(): this {
    this.rules = [];
    this.errors = [];
    return this;
  }
}

/**
 * @namespace ValidationRules
 * @description Pre-defined validation rules
 */
export namespace ValidationRules {
  /**
   * Check if value is not null or undefined
   */
  export const required = <T>(): ValidationRule<T> => ({
    validate: (value: T) => value !== null && value !== undefined,
    message: 'Value is required',
    code: 'REQUIRED',
  });

  /**
   * Check if string is not empty
   */
  export const notEmpty = (): ValidationRule<string> => ({
    validate: (value: string) =>
      typeof value === 'string' && value.trim().length > 0,
    message: 'String cannot be empty',
    code: 'NOT_EMPTY',
  });

  /**
   * Check if value is a number
   */
  export const isNumber = (): ValidationRule<unknown> => ({
    validate: (value: unknown) =>
      typeof value === 'number' && !Number.isNaN(value),
    message: 'Value must be a number',
    code: 'IS_NUMBER',
  });

  /**
   * Check if value is a finite number
   */
  export const isFiniteNumber = (): ValidationRule<number> => ({
    validate: (value: number) =>
      typeof value === 'number' && Number.isFinite(value),
    message: 'Value must be a finite number',
    code: 'IS_FINITE_NUMBER',
  });

  /**
   * Check if value is a positive number
   */
  export const isPositive = (): ValidationRule<number> => ({
    validate: (value: number) => typeof value === 'number' && value > 0,
    message: 'Value must be positive',
    code: 'IS_POSITIVE',
  });

  /**
   * Check if value is within a range
   */
  export const inRange = (
    min: number,
    max: number,
  ): ValidationRule<number> => ({
    validate: (value: number) =>
      typeof value === 'number' && value >= min && value <= max,
    message: `Value must be between ${min} and ${max}`,
    code: 'IN_RANGE',
  });

  /**
   * Check if value is an integer
   */
  export const isInteger = (): ValidationRule<number> => ({
    validate: (value: number) =>
      typeof value === 'number' && Number.isInteger(value),
    message: 'Value must be an integer',
    code: 'IS_INTEGER',
  });

  /**
   * Check if value is a boolean
   */
  export const isBoolean = (): ValidationRule<unknown> => ({
    validate: (value: unknown) => typeof value === 'boolean',
    message: 'Value must be a boolean',
    code: 'IS_BOOLEAN',
  });

  /**
   * Check if value is a string
   */
  export const isString = (): ValidationRule<unknown> => ({
    validate: (value: unknown) => typeof value === 'string',
    message: 'Value must be a string',
    code: 'IS_STRING',
  });

  /**
   * Check if string matches a pattern
   */
  export const matchesPattern = (pattern: RegExp): ValidationRule<string> => ({
    validate: (value: string) =>
      typeof value === 'string' && pattern.test(value),
    message: `Value must match pattern: ${pattern.toString()}`,
    code: 'MATCHES_PATTERN',
  });

  /**
   * Check if value is one of allowed values
   */
  export const oneOf = <T>(allowedValues: T[]): ValidationRule<T> => ({
    validate: (value: T) => allowedValues.includes(value),
    message: `Value must be one of: ${allowedValues.join(', ')}`,
    code: 'ONE_OF',
  });

  /**
   * Check if object has required properties
   */
  export const hasProperties = (
    properties: string[],
  ): ValidationRule<object> => ({
    validate: (value: object) => {
      if (typeof value !== 'object' || value === null) return false;
      return properties.every((prop) => prop in value);
    },
    message: `Object must have properties: ${properties.join(', ')}`,
    code: 'HAS_PROPERTIES',
  });

  /**
   * Check if array has minimum length
   */
  export const minLength = (min: number): ValidationRule<unknown[]> => ({
    validate: (value: unknown[]) => Array.isArray(value) && value.length >= min,
    message: `Array must have at least ${min} elements`,
    code: 'MIN_LENGTH',
  });

  /**
   * Check if array has maximum length
   */
  export const maxLength = (max: number): ValidationRule<unknown[]> => ({
    validate: (value: unknown[]) => Array.isArray(value) && value.length <= max,
    message: `Array must have at most ${max} elements`,
    code: 'MAX_LENGTH',
  });
}

/**
 * @namespace InputValidators
 * @description Pre-configured validators for common input types
 */
export namespace InputValidators {
  /**
   * Validate file input
   */
  export function validateFileInput(input: string, component?: string): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.isString());
    // Note: We allow empty strings for file input as it's a valid edge case
    // (e.g., empty trace files should be handled gracefully)

    if (
      !validator.validate(input, { component, operation: 'validateFileInput' })
    ) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate coordinate values
   */
  export function validateCoordinate(
    value: number,
    axis: string,
    component?: string,
  ): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.isNumber())
      .addRule(ValidationRules.isFiniteNumber());

    if (
      !validator.validate(value, {
        component,
        operation: `validateCoordinate(${axis})`,
      })
    ) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate tool number
   */
  export function validateToolNumber(
    toolNumber: number,
    component?: string,
  ): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.isNumber())
      .addRule(ValidationRules.isInteger())
      .addRule(ValidationRules.inRange(1, 999));

    if (
      !validator.validate(toolNumber, {
        component,
        operation: 'validateToolNumber',
      })
    ) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate spindle speed
   */
  export function validateSpindleSpeed(
    speed: number,
    component?: string,
  ): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.isNumber())
      .addRule(ValidationRules.isFiniteNumber())
      .addRule(ValidationRules.inRange(0, 99999));

    if (
      !validator.validate(speed, {
        component,
        operation: 'validateSpindleSpeed',
      })
    ) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate feed rate
   */
  export function validateFeedRate(feedRate: number, component?: string): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.isNumber())
      .addRule(ValidationRules.isFiniteNumber())
      .addRule(ValidationRules.isPositive());

    if (
      !validator.validate(feedRate, {
        component,
        operation: 'validateFeedRate',
      })
    ) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate G-code motion mode
   */
  export function validateMotionMode(mode: number, component?: string): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.isNumber())
      .addRule(ValidationRules.isInteger())
      .addRule(ValidationRules.oneOf([0, 1, 2, 3]));

    if (
      !validator.validate(mode, { component, operation: 'validateMotionMode' })
    ) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate plane selection
   */
  export function validatePlane(plane: number, component?: string): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.isNumber())
      .addRule(ValidationRules.isInteger())
      .addRule(ValidationRules.oneOf([17, 18, 19]));

    if (!validator.validate(plane, { component, operation: 'validatePlane' })) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate event name
   */
  export function validateEventName(
    eventName: string,
    component?: string,
  ): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.isString())
      .addRule(ValidationRules.notEmpty())
      .addRule(ValidationRules.matchesPattern(/^[A-Z][a-zA-Z0-9]*$/));

    if (
      !validator.validate(eventName, {
        component,
        operation: 'validateEventName',
      })
    ) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate event parameters
   */
  export function validateEventParameters(
    params: Record<string, unknown>,
    component?: string,
  ): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule({
        validate: (value) => typeof value === 'object' && value !== null,
        message: 'Event parameters must be an object',
        code: 'IS_OBJECT',
      });

    if (
      !validator.validate(params, {
        component,
        operation: 'validateEventParameters',
      })
    ) {
      throw validator.getErrors()[0];
    }
  }

  /**
   * Validate line number options
   */
  export function validateLineNumberOptions(
    options: { start: number; increment: number },
    component?: string,
  ): void {
    const validator = new Validator()
      .addRule(ValidationRules.required())
      .addRule(ValidationRules.hasProperties(['start', 'increment']));

    if (
      !validator.validate(options, {
        component,
        operation: 'validateLineNumberOptions',
      })
    ) {
      throw validator.getErrors()[0];
    }

    // Validate individual properties
    validateCoordinate(options.start, 'start', component);
    validateCoordinate(options.increment, 'increment', component);

    // Additional constraints
    if (options.start < 1 || options.increment < 1) {
      throw new ValidationError(
        'Line number start and increment must be positive',
        createErrorContext(component, 'validateLineNumberOptions', { options }),
      );
    }
  }
}

/**
 * @function createValidator
 * @description Factory function to create a validator with pre-configured rules
 */
export function createValidator(...rules: ValidationRule[]): Validator {
  const validator = new Validator();
  rules.forEach((rule) => {
    validator.addRule(rule);
  });
  return validator;
}

/**
 * @function validateSafely
 * @description Safely validate a value and return validation result
 */
export function validateSafely<T>(
  value: T,
  rules: ValidationRule<T>[],
  options: ValidatorOptions = {},
): { isValid: boolean; errors: ValidationError[] } {
  const validator = new Validator();
  rules.forEach((rule) => {
    validator.addRule(rule);
  });
  const isValid = validator.validate(value, options);
  return { isValid, errors: validator.getErrors() };
}

/**
 * @function assert
 * @description Assert that a condition is true, throw ValidationError if not
 */
export function assert(
  condition: boolean,
  message: string,
  component?: string,
  operation?: string,
): asserts condition {
  if (!condition) {
    throw new ValidationError(
      message,
      createErrorContext(component, operation),
      { recoverable: false, strategy: 'abort' },
    );
  }
}
