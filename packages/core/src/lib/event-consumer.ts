import type { EventData } from './parser';

/**
 * One-pass aggregation over a trace.
 *
 * Every summary Achar derives from a trace — timing, tool catalog, setup
 * partition, part metadata — is a fold: walk the events in order, keep a little
 * state, produce a result at the end. Expressed as a function taking
 * `EventData[]` that shape is invisible, and the cost of hiding it is that
 * `extractProductProfile` walked the same array four times. That was merely
 * wasteful while the array was already in memory. Now that events can arrive as
 * a stream it is a correctness problem: a generator is single-use, and walking
 * it a second time yields nothing at all — silently, with no error and no empty
 * check that would catch it.
 *
 * Naming the fold fixes both. Consumers are driven together over one pass, so a
 * stream is walked exactly once by construction rather than by discipline.
 */
export interface EventConsumer<T> {
  push(event: EventData): void;
  finish(): T;
}

/** Drives one consumer to completion over a single pass. */
export function runConsumer<T>(
  consumer: EventConsumer<T>,
  events: Iterable<EventData>,
): T {
  for (const event of events) consumer.push(event);
  return consumer.finish();
}

/**
 * Drives several consumers over a single pass, leaving each caller to call
 * `finish()` on its own consumer so the return types stay separate.
 */
export function runConsumers(
  events: Iterable<EventData>,
  consumers: readonly EventConsumer<unknown>[],
): void {
  for (const event of events) {
    for (const consumer of consumers) consumer.push(event);
  }
}
