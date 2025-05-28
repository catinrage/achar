import type { DeepPartial, EventsType } from '$src/types';
import { Builder } from './builder';
import type { EventData } from './parser';

/**
 * @description Configuration options for the Program class
 */
export type ProgramOptions = {
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
};

export type EventListenerMetadata = {
  /**
   * The index of the current event in the program
   */
  index: number;
  /**
   * The next event in the program
   */
  next: Event<keyof EventsType> | null;
  /**
   * The previous event in the program
   */
  previous: Event<keyof EventsType> | null;
  /**
   * Find the last event in the program, into the past
   */
  findLastEvent: <T extends keyof EventsType>(eventName: T) => Event<T> | null;
  /**
   * Find the nearest event in the program, into the future
   */
  findNearestEvent: <T extends keyof EventsType>(
    eventName: T,
  ) => Event<T> | null;
  /**
   * Find the nth next event in the program
   */
  findNthNextEvent: <T extends keyof EventsType>(
    eventName: T,
    n: number,
  ) => Event<T> | null;
  /**
   * Find the nth previous event in the program
   */
  findNthPreviousEvent: <T extends keyof EventsType>(
    eventName: T,
    n: number,
  ) => Event<T> | null;
};

/**
 * @type EventListener
 * @template T - A key of EventsType, representing the specific event name.
 * @description Defines the signature for an event listener function.
 * It receives event-specific parameters and a Builder instance to generate G-code.
 * @param {EventsType[T]} params - The parameters associated with the triggered event.
 * @param {Builder} builder - An instance of the Builder class for G-code generation.
 * @param {EventListenerMetadata} metadata - Metadata about the event listener.
 */
export type EventListener<T extends keyof EventsType = keyof EventsType> = (
  builder: Builder,
  params: EventsType[T],
  metadata: EventListenerMetadata,
) => void;

/**
 * @class Event
 * @template Name - A key of EventsType, representing the specific event name.
 * @description Represents a single parsed event from the input.
 * It holds the event name, its associated data, and a reference to the Program instance.
 */
class Event<Name extends keyof EventsType> {
  /**
   * @constructor
   * @param {Program} program - The Program instance this event belongs to.
   * @param {Name} name - The name of the event (e.g., 'StartOfFile', 'ToolChange').
   * @param {EventsType[Name]} data - The data/parameters associated with this event.
   */
  constructor(
    private program: Program,
    readonly name: Name,
    readonly data: EventsType[Name],
  ) {}

  /**
   * @method trigger
   * @description Triggers this event on its associated Program instance.
   * This will execute all registered listeners for this event name.
   */
  public trigger(metadata: EventListenerMetadata): void {
    this.program.trigger(this.name, this.data, metadata);
  }
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
   * The type uses `any` for the listener array internally to satisfy TypeScript's generic constraints,
   * but the public `on`, `off`, and `trigger` methods maintain strong typing.
   */
  private _eventListeners: Record<string, EventListener<any>[]> = {};

  /**
   * @private
   * @property _builder
   * @description An instance of the Builder class used to construct the G-code output.
   */
  private _builder: Builder;

  /**
   * @constructor
   * @description Initializes a new Program instance with an empty event list and a new Builder.
   */
  constructor(options?: DeepPartial<ProgramOptions>) {
    this._options = {
      numbering: {
        enabled: options?.numbering?.enabled ?? this._options.numbering.enabled,
        start: options?.numbering?.start ?? this._options.numbering.start,
        increment:
          options?.numbering?.increment ?? this._options.numbering.increment,
      },
    };
    this._builder = new Builder(this._options);
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
      const { _eventName, _index, ...data } = eventData;
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
    if (!this._eventListeners[eventName]) {
      this._eventListeners[eventName] = [];
    }
    // The `as any` is used here to bridge the general internal type with the specific external type.
    // This is safe due to the strong typing of `eventName` and `listener` in the method signature.
    this._eventListeners[eventName].push(listener);
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
    const listeners = this._eventListeners[eventName];
    if (listeners) {
      this._eventListeners[eventName] = listeners.filter((l) => l !== listener);
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
    const listeners = this._eventListeners[eventName];
    if (listeners) {
      listeners.forEach((listener) =>
        // Ensure params matches the listener's expectation; cast if necessary from Partial.
        // However, internal calls from process() will pass the full EventsType[T].
        listener(this._builder, params as EventsType[T], metadata),
      );
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

  /**
   * @method process
   * @description Processes all loaded events in sequence. For each event,
   * it triggers the event by calling its own trigger method, which in turn calls Program.trigger.
   * This is the main method to start G-code generation based on loaded events and registered handlers.
   */
  public process(): void {
    this._events.forEach((event, index) => {
      const metadata: EventListenerMetadata = {
        index: index,
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
  public generate(): string {
    this._builder.flush();
    return this._builder.gcode;
  }
}
