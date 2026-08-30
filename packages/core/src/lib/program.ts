import type { DeepPartial, EventsType } from '../types';
import { Builder, type BuilderFileOperation } from './builder';
import {
  ConfigurationError,
  createErrorContext,
  ErrorCollector,
  EventProcessingError,
  wrapError,
} from './errors';
import { Event, type EventListener, type EventListenerMetadata } from './event';
import { createLogger, LogLevel } from './logger';
import type { EventData } from './parser';
import { assert, InputValidators } from './validation';

/**
 * @description Configuration options for the Program class
 */
export interface ProgramOptions {
  /**
   * The name of the program, default is 'Setup'
   */
  programName: string;
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

/**
 * @interface ProgramExecutionOptions
 * @description Options for program execution
 */
export interface ProgramExecutionOptions {
  /**
   * Whether to continue processing after errors
   */
  continueOnError?: boolean;
  /**
   * Maximum number of errors before stopping
   */
  maxErrors?: number;
  /**
   * Whether to validate event data before processing
   */
  validateEvents?: boolean;
  /**
   * Whether to log execution progress
   */
  logProgress?: boolean;
  /**
   * Log level for execution
   */
  logLevel?: LogLevel;
}

/**
 * @class Program
 * @description Orchestrates the G-code generation process. It loads parsed events,
 * allows registration of event-specific listeners (handlers), and processes these events
 * to generate the final G-code using a Builder instance.
 */
export class Program {
  /**
   * @private
   * @property _options
   * @description The options for the Program.
   */
  private readonly _options: ProgramOptions = {
    programName: 'Setup',
    numbering: {
      enabled: true,
      start: 10,
      increment: 10,
    },
  };

  /**
   * @private
   * @property _events
   * @description An array of Event instances loaded from the parser.
   */
  private _events: Event<keyof EventsType>[] = [];

  /**
   * @private
   * @property _eventListeners
   * @description A map where keys are event names (strings) and values are arrays of EventListener functions for that event.
   */
  private _eventListeners: Map<string, EventListener[]> = new Map();

  /**
   * @private
   * @property _logger
   * @description Logger instance for this program
   */
  private _logger = createLogger('Program');

  /**
   * @private
   * @property _errorCollector
   * @description Error collector for gathering execution errors
   */
  private _errorCollector = new ErrorCollector();

  /**
   * @private
   * @property _executionOptions
   * @description Default execution options
   */
  private _executionOptions: ProgramExecutionOptions = {
    continueOnError: true,
    maxErrors: 50,
    validateEvents: true,
    logProgress: true,
    logLevel: LogLevel.INFO,
  };

  /**
   * @private
   * @property _builder
   * @description Builder instance for G-code generation
   */
  private _builder: Builder | null = null;

  /**
   * @constructor
   * @param {DeepPartial<ProgramOptions>} options - Optional settings for the program.
   */
  constructor(options: DeepPartial<ProgramOptions> = {}) {
    try {
      this._options = {
        ...this._options,
        ...options,
        numbering: {
          ...this._options.numbering,
          ...(options.numbering || {}),
        },
      };

      // Validate options
      this._validateOptions();

      this._logger.info(
        'Program initialized',
        {
          programName: this._options.programName,
          numbering: this._options.numbering,
        },
        'constructor',
      );
    } catch (error) {
      const wrappedError = wrapError(error, 'Program', 'constructor');
      this._logger.logError(wrappedError, 'constructor');
      throw wrappedError;
    }
  }

  /**
   * @private
   * @method _validateOptions
   * @description Validates program options
   */
  private _validateOptions(): void {
    try {
      // Validate program name
      InputValidators.validateFileInput(this._options.programName, 'Program');

      // Validate numbering options
      InputValidators.validateLineNumberOptions(
        this._options.numbering,
        'Program',
      );
    } catch (error) {
      throw new ConfigurationError(
        `Invalid program options: ${
          error instanceof Error ? error.message : String(error)
        }`,
        createErrorContext(
          'Program',
          '_validateOptions',
          { options: this._options },
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  /**
   * @method loadEvents
   * @description Loads an array of parsed EventData objects into the Program.
   * Each EventData object is converted into an Event instance.
   * @param {EventData[]} parsedEvents - An array of EventData objects from the Parser.
   */
  public loadEvents(parsedEvents: EventData<keyof EventsType>[]): void {
    parsedEvents.forEach((eventData) => {
      const eventName = eventData._eventName as keyof EventsType;
      // Ensure to pass only relevant data to the Event constructor,
      // matching EventsType[Name] by excluding _eventName and _index.
      const { _eventName, _index, _depth, ...data } = eventData;
      this._events.push(
        new Event(this, eventName, data as EventsType[typeof eventName]),
      );
    });
  }

  /**
   * @method on
   * @template T - A key of EventsType, representing the specific event name.
   * @description Registers an EventListener for a specific event name.
   * Multiple listeners can be registered for the same event.
   * EventListeners are executed in the order they are registered.
   * @param {T} eventName - The name of the event to listen for.
   * @param {EventListener<T>} listener - The callback function to execute when the event is triggered.
   */
  public on<T extends keyof EventsType>(
    eventName: T,
    listener: EventListener<T>,
  ): void {
    try {
      // Validate event name
      InputValidators.validateEventName(eventName, 'Program');

      // Validate listener
      assert(
        typeof listener === 'function',
        'Event listener must be a function',
        'Program',
        'on',
      );

      const eventKey = eventName as string;
      if (!this._eventListeners.has(eventKey)) {
        this._eventListeners.set(eventKey, []);
      }

      this._eventListeners.get(eventKey)?.push(listener as EventListener);

      this._logger.debug(
        `Registered event listener for ${eventKey}`,
        {
          eventName: eventKey,
          listenerCount: this._eventListeners.get(eventKey)?.length,
        },
        'on',
      );
    } catch (error) {
      const wrappedError = wrapError(error, 'Program', 'on');
      this._logger.logError(wrappedError, 'on');
      throw wrappedError;
    }
  }

  /**
   * @method off
   * @template T - A key of EventsType, representing the specific event name.
   * @description Removes a previously registered EventListener for a specific event name.
   * @param {T} eventName - The name of the event to stop listening for.
   * @param {EventListener<T>} listener - The specific listener function to remove.
   */
  public off<T extends keyof EventsType>(
    eventName: T,
    listener: EventListener<T>,
  ): void {
    try {
      const eventKey = eventName as string;
      const listeners = this._eventListeners.get(eventKey);

      if (listeners) {
        const filteredListeners = listeners.filter(
          (l: EventListener) => l !== listener,
        );
        this._eventListeners.set(eventKey, filteredListeners);

        this._logger.debug(
          `Removed event listener for ${eventKey}`,
          {
            eventName: eventKey,
            listenerCount: filteredListeners.length,
          },
          'off',
        );
      }
    } catch (error) {
      const wrappedError = wrapError(error, 'Program', 'off');
      this._logger.logError(wrappedError, 'off');
      throw wrappedError;
    }
  }

  /**
   * @method trigger
   * @template T - A key of EventsType, representing the specific event name.
   * @description Manually triggers a specific event, executing all its registered listeners.
   * Listeners are called with the provided parameters and the Program's Builder instance.
   * @param {T} eventName - The name of the event to trigger.
   * @param {EventsType[T]} params - The parameters to pass to the event listeners.
   */
  public trigger<T extends keyof EventsType>(
    eventName: T,
    params: EventsType[T] | Partial<EventsType[T]>, // Allow partial for manual trigger if needed by original code
    metadata: EventListenerMetadata,
  ): void {
    try {
      const eventKey = eventName as string;
      const listeners = this._eventListeners.get(eventKey);

      if (listeners && listeners.length > 0) {
        this._logger.debug(
          `Triggering ${listeners.length} listeners for ${eventKey}`,
          {
            eventName: eventKey,
            listenerCount: listeners.length,
          },
          'trigger',
        );

        // Ensure builder is initialized
        if (!this._builder) {
          this._builder = new Builder({
            mainFileName: `${this._options.programName}.MPF`,
            numbering: this._options.numbering,
          });
        }
        const builder = this._builder;

        listeners.forEach((listener: EventListener, index: number) => {
          try {
            // Set current event context
            builder.currentEvent = new Event(
              this,
              eventName,
              params as EventsType[T],
            );
            builder.currentEventListenerIndex = index;
            builder.currentEventIndex = metadata.index;

            // Called directly, and synchronously, so a listener that throws
            // is caught below rather than escaping as an unhandled rejection.
            listener(builder, params as EventsType[keyof EventsType], metadata);
          } catch (error) {
            const processingError = new EventProcessingError(
              `Event listener failed for ${eventKey} (listener ${index}): ${
                error instanceof Error ? error.message : String(error)
              }`,
              createErrorContext(
                'Program',
                'trigger',
                {
                  eventName: eventKey,
                  listenerIndex: index,
                  eventData: params,
                },
                error instanceof Error ? error : undefined,
              ),
            );

            this._errorCollector.add(processingError);
            this._logger.logError(processingError, 'trigger');

            if (!this._executionOptions.continueOnError) {
              throw processingError;
            }
          }
        });
      } else {
        this._logger.debug(
          `No listeners registered for ${eventKey}`,
          {
            eventName: eventKey,
          },
          'trigger',
        );
      }
    } catch (error) {
      const wrappedError = wrapError(error, 'Program', 'trigger');
      this._logger.logError(wrappedError, 'trigger');
      throw wrappedError;
    }
  }

  /**
   * @method listEvents
   * @description Returns an array of names of all events currently loaded in the program.
   * @returns {Array<keyof EventsType>} An array of event names.
   */
  public listEvents(): Array<keyof EventsType> {
    return this._events.map((event) => event.name);
  }

  public registeredEvents(): Array<keyof EventsType> {
    return [...this._eventListeners.keys()] as Array<keyof EventsType>;
  }

  public explain(filter?: { file?: string; event?: string }): string {
    return this._builder?.explain(filter) ?? '';
  }

  /**
   * @method process
   * @description Processes all loaded events in sequence. For each event,
   * it triggers the event by calling its own trigger method, which in turn calls Program.trigger.
   * This is the main method to start G-code generation based on loaded events and registered handlers.
   */
  public process(): void {
    // Initialize builder if not already done
    if (!this._builder) {
      this._builder = new Builder({
        mainFileName: `${this._options.programName}.MPF`,
        numbering: this._options.numbering,
      });
    }

    const eventCallCounter: Record<string, number> = {};

    this._events.forEach((event, index) => {
      if (eventCallCounter[event.name] !== undefined) {
        eventCallCounter[event.name]++;
      } else {
        eventCallCounter[event.name] = 0;
      }

      const metadata: EventListenerMetadata = {
        index: index,
        eventCallCounter: eventCallCounter[event.name],
        currentFile: () => {
          if (!this._builder) {
            throw new EventProcessingError(
              'Builder not initialized',
              createErrorContext('Program', 'execute', {
                eventName: event.name,
              }),
            );
          }
          return this._builder.currentFile;
        },
        next: this._events[index + 1] ?? null,
        previous: this._events[index - 1] ?? null,
        findLastEvent: <T extends keyof EventsType>(eventName: T) => {
          // go backward until the event is found
          for (let i = index - 1; i >= 0; i--) {
            if (this._events[i].name === eventName) {
              return this._events[i] as Event<T>;
            }
          }
          return null;
        },
        findNearestEvent: <T extends keyof EventsType>(eventName: T) => {
          // go forward until the event is found
          for (let i = index + 1; i < this._events.length; i++) {
            if (this._events[i].name === eventName) {
              return this._events[i] as Event<T>;
            }
          }
          return null;
        },
        findNthNextEvent: <T extends keyof EventsType>(
          eventName: T,
          n: number,
        ) => {
          for (let i = index + 1; i < this._events.length; i++) {
            if (this._events[i].name === eventName) {
              n--;
              if (n === 0) {
                return this._events[i] as Event<T>;
              }
            }
          }
          return null;
        },
        findNthPreviousEvent: <T extends keyof EventsType>(
          eventName: T,
          n: number,
        ) => {
          for (let i = index - 1; i >= 0; i--) {
            if (this._events[i].name === eventName) {
              n--;
              if (n === 0) {
                return this._events[i] as Event<T>;
              }
            }
          }
          return null;
        },
        findLastEventOrThrow: <T extends keyof EventsType>(eventName: T) => {
          const event = metadata.findLastEvent(eventName);
          if (!event) {
            throw new EventProcessingError(
              `Could not find last event '${eventName}'`,
              createErrorContext('Program', 'process', {
                targetEventName: eventName,
                currentEventName: this._events[index].name,
                currentIndex: index,
              }),
            );
          }
          return event;
        },
        findNearestEventOrThrow: <T extends keyof EventsType>(eventName: T) => {
          const event = metadata.findNearestEvent(eventName);
          if (!event) {
            throw new EventProcessingError(
              `Could not find nearest event '${eventName}'`,
              createErrorContext('Program', 'process', {
                targetEventName: eventName,
                currentEventName: this._events[index].name,
                currentIndex: index,
              }),
            );
          }
          return event;
        },
        findNthNextEventOrThrow: <T extends keyof EventsType>(
          eventName: T,
          n: number,
        ) => {
          const event = metadata.findNthNextEvent(eventName, n);
          if (!event) {
            throw new EventProcessingError(
              `Could not find ${n}th next event '${eventName}'`,
              createErrorContext('Program', 'process', {
                targetEventName: eventName,
                currentEventName: this._events[index].name,
                currentIndex: index,
                n,
              }),
            );
          }
          return event;
        },
        findNthPreviousEventOrThrow: <T extends keyof EventsType>(
          eventName: T,
          n: number,
        ) => {
          const event = metadata.findNthPreviousEvent(eventName, n);
          if (!event) {
            throw new EventProcessingError(
              `Could not find ${n}th previous event '${eventName}'`,
              createErrorContext('Program', 'process', {
                targetEventName: eventName,
                currentEventName: this._events[index].name,
                currentIndex: index,
                n,
              }),
            );
          }
          return event;
        },
      };
      this.trigger(event.name, event.data, metadata);
    });
  }

  /**
   * @method generate
   * @description Returns the complete G-code string generated by the Builder
   * after all relevant events have been processed and their listeners have run.
   * @returns {string} The generated G-code program.
   */
  public generate(): {
    file: string;
    code: string;
  }[] {
    try {
      if (!this._builder) {
        this._builder = new Builder({
          mainFileName: `${this._options.programName}.MPF`,
          numbering: this._options.numbering,
        });
      }

      this._builder.flush();
      return this._builder.build();
    } catch (error) {
      const wrappedError = wrapError(error, 'Program', 'generate');
      this._logger.logError(wrappedError, 'generate');
      throw wrappedError;
    }
  }

  /**
   * @method fileOperations
   * @description Every file this program opened, in order, with the mode.
   *
   * Empty before `process`/`generate` has built a builder.
   */
  public get fileOperations(): readonly BuilderFileOperation[] {
    return this._builder?.fileOperations ?? [];
  }

  /**
   * @method getErrors
   * @description Get all collected errors
   * @returns {EventProcessingError[]} Array of collected errors
   */
  public getErrors(): EventProcessingError[] {
    return this._errorCollector.getAll();
  }

  /**
   * @method hasErrors
   * @description Check if program has collected any errors
   * @returns {boolean} True if there are errors
   */
  public hasErrors(): boolean {
    return this._errorCollector.hasErrors();
  }

  /**
   * @method clearErrors
   * @description Clear all collected errors
   */
  public clearErrors(): void {
    this._errorCollector.clear();
  }

  /**
   * @method getErrorSummary
   * @description Get a summary of all collected errors
   * @returns {string} Error summary
   */
  public getErrorSummary(): string {
    return this._errorCollector.getSummary();
  }

  /**
   * @method setExecutionOptions
   * @description Update execution options
   */
  public setExecutionOptions(options: Partial<ProgramExecutionOptions>): void {
    this._executionOptions = { ...this._executionOptions, ...options };
    this._logger.setLevel(this._executionOptions.logLevel || LogLevel.INFO);
  }
}
