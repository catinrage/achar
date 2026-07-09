/**
 * @file logger.ts
 * @description Structured logging system for the Achar CNC Post-Processor
 * Provides enterprise-level logging with multiple levels, formatters, and outputs
 */

import chalk from 'chalk';
import { type AcharError, isAcharError } from './errors';

/**
 * @enum LogLevel
 * @description Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

/**
 * @interface LogEntry
 * @description Structure for log entries
 */
export interface LogEntry {
  /**
   * Timestamp of the log entry
   */
  timestamp: Date;
  /**
   * Log level
   */
  level: LogLevel;
  /**
   * Log message
   */
  message: string;
  /**
   * Component or module that generated the log
   */
  component?: string;
  /**
   * Operation being performed
   */
  operation?: string;
  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
  /**
   * Error object if applicable
   */
  error?: Error | AcharError;
  /**
   * Stack trace if available
   */
  stack?: string;
}

/**
 * @interface LoggerOptions
 * @description Configuration options for the logger
 */
export interface LoggerOptions {
  /**
   * Whether or not output any log at all
   */
  enabled: boolean;
  /**
   * Minimum log level to output
   */
  level: LogLevel;
  /**
   * Component name for this logger instance
   */
  component?: string;
  /**
   * Whether to include timestamps
   */
  includeTimestamp: boolean;
  /**
   * Whether to include stack traces for errors
   */
  includeStackTrace: boolean;
  /**
   * Maximum number of log entries to keep in memory
   */
  maxLogEntries: number;
  /**
   * Custom log formatters
   */
  formatters: LogFormatter[];
  /**
   * Custom log outputs
   */
  outputs: LogOutput[];
}

/**
 * @interface LogFormatter
 * @description Interface for log formatters
 */
export interface LogFormatter {
  /**
   * Format a log entry
   */
  format(entry: LogEntry): string;
}

/**
 * @interface LogOutput
 * @description Interface for log outputs
 */
export interface LogOutput {
  /**
   * Write a formatted log entry
   */
  write(formatted: string, entry: LogEntry): void;
}

/**
 * @class ConsoleOutput
 * @description Console output for logs
 */
export class ConsoleOutput implements LogOutput {
  write(formatted: string, entry: LogEntry): void {
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formatted);
        break;
      default:
        console.log(formatted);
    }
  }
}

/**
 * @class MemoryOutput
 * @description In-memory log storage
 */
export class MemoryOutput implements LogOutput {
  private entries: LogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  write(_: string, entry: LogEntry): void {
    this.entries.push(entry);

    // Keep only the most recent entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * Get all stored log entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by level
   */
  getEntriesByLevel(level: LogLevel): LogEntry[] {
    return this.entries.filter((entry) => entry.level === level);
  }

  /**
   * Get entries by component
   */
  getEntriesByComponent(component: string): LogEntry[] {
    return this.entries.filter((entry) => entry.component === component);
  }

  /**
   * Clear all stored entries
   */
  clear(): void {
    this.entries = [];
  }
}

/**
 * @class DefaultFormatter
 * @description Default log formatter
 */
export class DefaultFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level];
    const component = entry.component ? ` [${entry.component}] ` : '';
    const operation = entry.operation ? `(${entry.operation})` : '';

    let message = `${chalk.bgWhite(timestamp)} ${level}${component}${operation}: ${chalk.white(entry.message)}`;

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      message += chalk.dim(
        `\n  Metadata: ${JSON.stringify(entry.metadata, null, 2)}`,
      );
    }

    if (entry.error) {
      if (isAcharError(entry.error)) {
        message += `\n  Error Details: ${entry.error.getDetailedReport()}`;
      } else {
        message += `\n  Error: ${entry.error.message}`;
      }
    }

    if (entry.stack) {
      message += `\n  Stack: ${entry.stack}`;
    }

    return message;
  }
}

/**
 * @class JSONFormatter
 * @description JSON log formatter
 */
export class JSONFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const logObject = {
      timestamp: entry.timestamp.toISOString(),
      level: LogLevel[entry.level],
      message: entry.message,
      component: entry.component,
      operation: entry.operation,
      metadata: entry.metadata,
      error: entry.error
        ? {
            name: entry.error.name,
            message: entry.error.message,
            ...(isAcharError(entry.error)
              ? {
                  code: entry.error.code,
                  severity: entry.error.severity,
                  context: entry.error.context,
                }
              : {}),
          }
        : undefined,
      stack: entry.stack,
    };

    return JSON.stringify(logObject);
  }
}

/**
 * @class Logger
 * @description Main logger class
 */
export class Logger {
  static globalOptions: LoggerOptions = {
    enabled: process.env.NODE_ENV !== 'test',
    level: LogLevel.INFO,
    includeTimestamp: true,
    includeStackTrace: true,
    maxLogEntries: 1000,
    formatters: [new DefaultFormatter()],
    outputs: [new ConsoleOutput()],
  };

  static setGlobalOptions(options: Partial<LoggerOptions>) {
    Logger.globalOptions = {
      ...Logger.globalOptions,
      ...options,
    };
  }

  private options: LoggerOptions;
  private static instance: Logger;

  constructor(options: Partial<LoggerOptions> = {}) {
    this.options = {
      ...Logger.globalOptions,
      ...options,
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(options?: Partial<LoggerOptions>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(options);
    }
    return Logger.instance;
  }

  /**
   * Create a child logger with a specific component
   */
  child(component: string): Logger {
    return new Logger({
      ...this.options,
      component,
    });
  }

  /**
   * Log a message at debug level
   */
  debug(
    message: string,
    metadata?: Record<string, unknown>,
    operation?: string,
  ): void {
    this.log(LogLevel.DEBUG, message, metadata, operation);
  }

  /**
   * Log a message at info level
   */
  info(
    message: string,
    metadata?: Record<string, unknown>,
    operation?: string,
  ): void {
    this.log(LogLevel.INFO, message, metadata, operation);
  }

  /**
   * Log a message at warn level
   */
  warn(
    message: string,
    metadata?: Record<string, unknown>,
    operation?: string,
  ): void {
    this.log(LogLevel.WARN, message, metadata, operation);
  }

  /**
   * Log a message at error level
   */
  error(
    message: string,
    error?: Error | AcharError,
    metadata?: Record<string, unknown>,
    operation?: string,
  ): void {
    this.log(LogLevel.ERROR, message, metadata, operation, error);
  }

  /**
   * Log a message at fatal level
   */
  fatal(
    message: string,
    error?: Error | AcharError,
    metadata?: Record<string, unknown>,
    operation?: string,
  ): void {
    this.log(LogLevel.FATAL, message, metadata, operation, error);
  }

  /**
   * Log an error object
   */
  logError(error: Error | AcharError, operation?: string): void {
    const message = isAcharError(error)
      ? `${error.name}: ${error.message}`
      : `Error: ${error.message}`;

    const metadata = isAcharError(error)
      ? { code: error.code, severity: error.severity }
      : {};

    this.log(LogLevel.ERROR, message, metadata, operation, error);
  }

  /**
   * Log a performance measurement
   */
  logPerformance(
    operation: string,
    duration: number,
    metadata?: Record<string, unknown>,
  ): void {
    this.log(
      LogLevel.INFO,
      `Performance: ${operation} took ${duration}ms`,
      metadata,
      operation,
    );
  }

  /**
   * Log with explicit level
   */
  log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    operation?: string,
    error?: Error | AcharError,
  ): void {
    if (!this.options.enabled) {
      return;
    }

    if (level < this.options.level) {
      // Check if this log level should be output
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      component: this.options.component,
      operation,
      metadata,
      error,
      stack: error && this.options.includeStackTrace ? error.stack : undefined,
    };

    // Format and output the log entry
    for (const formatter of this.options.formatters) {
      const formatted = formatter.format(entry);

      for (const output of this.options.outputs) {
        output.write(formatted, entry);
      }
    }
  }

  /**
   * Get memory output if configured
   */
  getMemoryOutput(): MemoryOutput | undefined {
    return this.options.outputs.find(
      (output) => output instanceof MemoryOutput,
    ) as MemoryOutput;
  }

  /**
   * Update logger options
   */
  updateOptions(options: Partial<LoggerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.options.level = level;
  }

  /**
   * Add a log formatter
   */
  addFormatter(formatter: LogFormatter): void {
    this.options.formatters.push(formatter);
  }

  /**
   * Add a log output
   */
  addOutput(output: LogOutput): void {
    this.options.outputs.push(output);
  }

  /**
   * Remove all formatters and outputs
   */
  clearFormattersAndOutputs(): void {
    this.options.formatters = [];
    this.options.outputs = [];
  }
}

/**
 * @function createLogger
 * @description Factory function to create a logger with common configurations
 */
export function createLogger(
  component?: string,
  level: LogLevel = LogLevel.INFO,
): Logger {
  const memoryOutput = new MemoryOutput();

  return new Logger({
    level,
    component,
    includeTimestamp: true,
    includeStackTrace: true,
    maxLogEntries: 1000,
    formatters: [new DefaultFormatter()],
    outputs: [new ConsoleOutput(), memoryOutput],
  });
}

/**
 * @function createFileLogger
 * @description Factory function to create a logger that also writes to a file
 */
export function createFileLogger(
  component?: string,
  level: LogLevel = LogLevel.INFO,
): Logger {
  const memoryOutput = new MemoryOutput();

  return new Logger({
    level,
    component,
    includeTimestamp: true,
    includeStackTrace: true,
    maxLogEntries: 1000,
    formatters: [new DefaultFormatter(), new JSONFormatter()],
    outputs: [new ConsoleOutput(), memoryOutput],
  });
}

/**
 * @function measurePerformance
 * @description Utility function to measure and log performance
 */
export function measurePerformance<T>(
  operation: string,
  fn: () => T,
  logger: Logger,
  metadata?: Record<string, unknown>,
): T {
  const start = performance.now();

  try {
    const result = fn();
    const duration = performance.now() - start;
    logger.logPerformance(operation, duration, metadata);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    logger.logPerformance(`${operation} (failed)`, duration, metadata);
    throw error;
  }
}

/**
 * @function measureAsyncPerformance
 * @description Utility function to measure and log async performance
 */
export async function measureAsyncPerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  logger: Logger,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const start = performance.now();

  try {
    const result = await fn();
    const duration = performance.now() - start;
    logger.logPerformance(operation, duration, metadata);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    logger.logPerformance(`${operation} (failed)`, duration, metadata);
    throw error;
  }
}

// Export default logger instance
export const defaultLogger = createLogger('achar');
