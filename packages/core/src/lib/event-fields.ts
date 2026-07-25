import type { EventData } from './parser';

/**
 * Tolerant readers for raw Trace 5 event fields.
 *
 * Real traces omit fields and occasionally carry the wrong primitive type for
 * one, so every extractor that builds a public API shape reads through these:
 * a missing or unusable value becomes `undefined` instead of throwing or
 * leaking `NaN` into a response body.
 */

export type EventFields = Record<string, unknown>;

/** Views an event as a plain field bag, bypassing the per-event typing. */
export function fieldsOf(event: EventData): EventFields {
  return event as unknown as EventFields;
}

/** Reads a non-empty string field, or `undefined`. */
export function readString(
  fields: EventFields,
  key: string,
): string | undefined {
  const value = fields[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads a finite number field, or `undefined`. */
export function readNumber(
  fields: EventFields,
  key: string,
): number | undefined {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Reads a SolidCAM 0/1 integer flag as a boolean, or `undefined`. */
export function readBoolean(
  fields: EventFields,
  key: string,
): boolean | undefined {
  const value = fields[key];
  if (typeof value === 'boolean') return value;
  const numeric = readNumber(fields, key);
  return numeric === undefined ? undefined : numeric !== 0;
}
