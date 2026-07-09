import type { EventsType } from '../types';
import type { Builder } from './builder';
import type { File } from './file';
import type { Program } from './program';

export interface EventListenerMetadata {
  /**
   * The index of the current event in the program
   */
  index: number;
  /**
   * Specifies the how many times this event have been called as of now, for example the value 0 means its the first time this event is being called,
   * the value 3 means this event has been called 3 times and so on...
   */
  eventCallCounter: number;
  /**
   * The current file in the program
   */
  currentFile: () => File;
  /**
   * The next event in the program
   */
  next: Event<keyof EventsType> | null;
  /**
   * The previous event in the program
   */
  previous: Event<keyof EventsType> | null;
  /**
   * Find the last event before the current event that matches the event name
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
  /**
   * Find the last event before the current event that matches the event name, or throw if not found
   */
  findLastEventOrThrow: <T extends keyof EventsType>(eventName: T) => Event<T>;
  /**
   * Find the nearest event in the program, into the future, or throw if not found
   */
  findNearestEventOrThrow: <T extends keyof EventsType>(
    eventName: T,
  ) => Event<T>;
  /**
   * Find the nth next event in the program, or throw if not found
   */
  findNthNextEventOrThrow: <T extends keyof EventsType>(
    eventName: T,
    n: number,
  ) => Event<T>;
  /**
   * Find the nth previous event in the program, or throw if not found
   */
  findNthPreviousEventOrThrow: <T extends keyof EventsType>(
    eventName: T,
    n: number,
  ) => Event<T>;
}

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
export class Event<Name extends keyof EventsType> {
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
