import type { EventsType } from '$src/types';
import { Builder } from './builder';
import type { EventData } from './parser';

/**
 * @type EventListener
 * @template T - A key of EventsType, representing the specific event name.
 * @description Defines the signature for an event listener function.
 * It receives event-specific parameters and a Builder instance to generate G-code.
 * @param {EventsType[T]} params - The parameters associated with the triggered event.
 * @param {Builder} builder - An instance of the Builder class for G-code generation.
 */
export type EventListener<T extends keyof EventsType = keyof EventsType> = (
  params: EventsType[T],
  builder: Builder,
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
  public trigger(): void {
    this.program.trigger(this.name, this.data);
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
   * @property events
   * @description An array of Event instances loaded from the parser.
   */
  private events: Event<keyof EventsType>[] = [];
  /**
   * @private
   * @property eventListeners
   * @description A map where keys are event names (strings) and values are arrays of EventListener functions for that event.
   * The type uses `any` for the listener array internally to satisfy TypeScript's generic constraints,
   * but the public `on`, `off`, and `trigger` methods maintain strong typing.
   */
  private eventListeners: Record<string, EventListener<any>[]> = {};

  /**
   * @private
   * @property builder
   * @description An instance of the Builder class used to construct the G-code output.
   */
  private builder: Builder = new Builder();

  /**
   * @constructor
   * @description Initializes a new Program instance with an empty event list and a new Builder.
   */
  constructor() {
    // this.events = []; // Initialization is now done at property declaration.
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
      this.events.push(
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
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    // The `as any` is used here to bridge the general internal type with the specific external type.
    // This is safe due to the strong typing of `eventName` and `listener` in the method signature.
    this.eventListeners[eventName].push(listener as any);
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
    const listeners = this.eventListeners[eventName];
    if (listeners) {
      this.eventListeners[eventName] = listeners.filter((l) => l !== listener);
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
  ): void {
    const listeners = this.eventListeners[eventName];
    if (listeners) {
      listeners.forEach((listener) =>
        // Ensure params matches the listener's expectation; cast if necessary from Partial.
        // However, internal calls from process() will pass the full EventsType[T].
        listener(params as EventsType[T], this.builder),
      );
    }
  }

  /**
   * @method listEvents
   * @description Returns an array of names of all events currently loaded in the program.
   * @returns {Array<keyof EventsType>} An array of event names.
   */
  public listEvents(): Array<keyof EventsType> {
    return this.events.map((event) => event.name);
  }

  /**
   * @method process
   * @description Processes all loaded events in sequence. For each event,
   * it triggers the event by calling its own trigger method, which in turn calls Program.trigger.
   * This is the main method to start G-code generation based on loaded events and registered handlers.
   */
  public process(): void {
    this.events.forEach((event) => {
      event.trigger(); // This will call Program.trigger with event.name and event.data
    });
  }

  /**
   * @method generate
   * @description Returns the complete G-code string generated by the Builder
   * after all relevant events have been processed and their listeners have run.
   * @returns {string} The generated G-code program.
   */
  public generate(): string {
    return this.builder.gcode;
  }
}
