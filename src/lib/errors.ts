/**
 * @file errors.ts
 * @description Comprehensive error handling system for the Achar CNC Post-Processor.
 * Provides custom error classes, error context, and utilities for enterprise-level error handling.
 */

/**
 * @interface ErrorContext
 * @description Provides additional context information for errors
 */
export interface ErrorContext {
  /**
   * The component or module where the error occurred
   */
  component?: string;
  /**
   * The operation being performed when the error occurred
   */
  operation?: string;
  /**
   * Additional metadata about the error
   */
  metadata?: Record<string, unknown>;
  /**
   * The original error that caused this error (if any)
   */
  cause?: Error;
  /**
   * Timestamp when the error occurred
   */
  timestamp?: Date;
  /**
   * Stack trace information
   */
  stack?: string;
}

/**
 * @interface ErrorRecoveryOptions
 * @description Options for error recovery mechanisms
 */
export interface ErrorRecoveryOptions {
  /**
   * Whether to attempt recovery from this error
   */
  recoverable?: boolean;
  /**
   * Recovery strategy to use
   */
  strategy?: 'retry' | 'skip' | 'default' | 'abort';
  /**
   * Maximum number of retry attempts
   */
  maxRetries?: number;
  /**
   * Default value to use if recovery is possible
   */
  defaultValue?: unknown;
}

/**
 * @class AcharError
 * @description Base error class for all Achar-specific errors.
 * Provides enhanced error context and recovery options.
 */
export class AcharError extends Error {
  /**
   * Error code for programmatic error handling
   */
  public readonly code: string;

  /**
   * Additional context information
   */
  public readonly context: ErrorContext;

  /**
   * Error recovery options
   */
  public readonly recovery: ErrorRecoveryOptions;

  /**
   * Error severity level
   */
  public readonly severity: 'low' | 'medium' | 'high' | 'critical';

  /**
   * @constructor
   * @param message - The error message
   * @param code - Unique error code
   * @param context - Additional error context
   * @param recovery - Error recovery options
   * @param severity - Error severity level
   */
  constructor(
    message: string,
    code: string = 'ACHAR_ERROR',
    context: ErrorContext = {},
    recovery: ErrorRecoveryOptions = {},
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = {
      timestamp: new Date(),
      ...context,
    };
    this.recovery = recovery;
    this.severity = severity;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging and serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      recovery: this.recovery,
      severity: this.severity,
      stack: this.stack,
    };
  }

  /**
   * Create a detailed error report
   */
  getDetailedReport(): string {
    const lines = [
      `Error: ${this.name}`,
      `Code: ${this.code}`,
      `Message: ${this.message}`,
      `Severity: ${this.severity}`,
      `Timestamp: ${this.context.timestamp?.toISOString() || 'Unknown'}`,
    ];

    if (this.context.component) {
      lines.push(`Component: ${this.context.component}`);
    }

    if (this.context.operation) {
      lines.push(`Operation: ${this.context.operation}`);
    }

    if (this.context.metadata) {
      lines.push(`Metadata: ${JSON.stringify(this.context.metadata, null, 2)}`);
    }

    if (this.context.cause) {
      lines.push(`Caused by: ${this.context.cause.message}`);
    }

    if (this.recovery.recoverable) {
      lines.push(`Recovery: ${this.recovery.strategy || 'default'}`);
    }

    return lines.join('\n');
  }
}

/**
 * @class ParseError
 * @description Error thrown during parsing operations
 */
export class ParseError extends AcharError {
  constructor(
    message: string,
    context: ErrorContext = {},
    recovery: ErrorRecoveryOptions = { recoverable: true, strategy: 'skip' },
  ) {
    super(message, 'PARSE_ERROR', context, recovery, 'high');
  }
}

/**
 * @class ValidationError
 * @description Error thrown during input validation
 */
export class ValidationError extends AcharError {
  constructor(
    message: string,
    context: ErrorContext = {},
    recovery: ErrorRecoveryOptions = { recoverable: true, strategy: 'default' },
  ) {
    super(message, 'VALIDATION_ERROR', context, recovery, 'medium');
  }
}

/**
 * @class MachineStateError
 * @description Error thrown during machine state operations
 */
export class MachineStateError extends AcharError {
  constructor(
    message: string,
    context: ErrorContext = {},
    recovery: ErrorRecoveryOptions = { recoverable: true, strategy: 'default' },
  ) {
    super(message, 'MACHINE_STATE_ERROR', context, recovery, 'high');
  }
}

/**
 * @class BuilderError
 * @description Error thrown during G-code building operations
 */
export class BuilderError extends AcharError {
  constructor(
    message: string,
    context: ErrorContext = {},
    recovery: ErrorRecoveryOptions = { recoverable: true, strategy: 'skip' },
  ) {
    super(message, 'BUILDER_ERROR', context, recovery, 'high');
  }
}

/**
 * @class EventProcessingError
 * @description Error thrown during event processing operations
 */
export class EventProcessingError extends AcharError {
  constructor(
    message: string,
    context: ErrorContext = {},
    recovery: ErrorRecoveryOptions = { recoverable: true, strategy: 'skip' },
  ) {
    super(message, 'EVENT_PROCESSING_ERROR', context, recovery, 'high');
  }
}

/**
 * @class FileOperationError
 * @description Error thrown during file operations
 */
export class FileOperationError extends AcharError {
  constructor(
    message: string,
    context: ErrorContext = {},
    recovery: ErrorRecoveryOptions = { recoverable: false, strategy: 'abort' },
  ) {
    super(message, 'FILE_OPERATION_ERROR', context, recovery, 'critical');
  }
}

/**
 * @class ConfigurationError
 * @description Error thrown due to invalid configuration
 */
export class ConfigurationError extends AcharError {
  constructor(
    message: string,
    context: ErrorContext = {},
    recovery: ErrorRecoveryOptions = { recoverable: true, strategy: 'default' },
  ) {
    super(message, 'CONFIGURATION_ERROR', context, recovery, 'medium');
  }
}

/**
 * @class ErrorCollector
 * @description Utility class for collecting and managing multiple errors
 */
export class ErrorCollector {
  private errors: AcharError[] = [];

  /**
   * Add an error to the collection
   */
  add(error: AcharError): void {
    this.errors.push(error);
  }

  /**
   * Get all collected errors
   */
  getAll(): AcharError[] {
    return [...this.errors];
  }

  /**
   * Get errors by severity level
   */
  getBySeverity(
    severity: 'low' | 'medium' | 'high' | 'critical',
  ): AcharError[] {
    return this.errors.filter((error) => error.severity === severity);
  }

  /**
   * Get errors by component
   */
  getByComponent(component: string): AcharError[] {
    return this.errors.filter((error) => error.context.component === component);
  }

  /**
   * Check if there are any errors
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Check if there are any critical errors
   */
  hasCriticalErrors(): boolean {
    return this.errors.some((error) => error.severity === 'critical');
  }

  /**
   * Clear all errors
   */
  clear(): void {
    this.errors = [];
  }

  /**
   * Get a summary of all errors
   */
  getSummary(): string {
    if (this.errors.length === 0) {
      return 'No errors collected';
    }

    const summary = [
      `Total errors: ${this.errors.length}`,
      `Critical: ${this.getBySeverity('critical').length}`,
      `High: ${this.getBySeverity('high').length}`,
      `Medium: ${this.getBySeverity('medium').length}`,
      `Low: ${this.getBySeverity('low').length}`,
    ];

    return summary.join('\n');
  }
}

/**
 * @function isAcharError
 * @description Type guard to check if an error is an AcharError
 */
export function isAcharError(error: unknown): error is AcharError {
  return error instanceof AcharError;
}

/**
 * @function createErrorContext
 * @description Helper function to create error context
 */
export function createErrorContext(
  component?: string,
  operation?: string,
  metadata?: Record<string, unknown>,
  cause?: Error,
): ErrorContext {
  return {
    component,
    operation,
    metadata,
    cause,
    timestamp: new Date(),
  };
}

/**
 * @function wrapError
 * @description Utility function to wrap non-AcharError errors
 */
export function wrapError(
  error: unknown,
  component?: string,
  operation?: string,
): AcharError {
  if (isAcharError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const context = createErrorContext(
    component,
    operation,
    undefined,
    error instanceof Error ? error : undefined,
  );

  return new AcharError(
    `Unexpected error: ${message}`,
    'WRAPPED_ERROR',
    context,
    { recoverable: false, strategy: 'abort' },
    'high',
  );
}
