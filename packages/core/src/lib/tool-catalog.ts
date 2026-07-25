import type { EventFields } from './event-fields';
import { fieldsOf, readNumber, readString } from './event-fields';
import type { EventData } from './parser';

/**
 * Tool catalog extraction from Trace 5 events.
 *
 * SolidCAM emits one `def_tool` per tool per setup, so the same tool appears
 * many times in a trace with identical geometry. This module collapses those
 * into one entry per `tool_id_string` and renames the fields to camelCase:
 * `def_tool` snake_case is a SolidCAM implementation detail and must not leak
 * into a public API.
 *
 * Real traces omit fields freely — every field except `toolIdString` is
 * optional and a missing or wrong-typed value is simply dropped.
 */

export interface ToolCatalogEntry {
  toolIdString: string;
  name?: string;
  description?: string;
  type?: string;
  userType?: string;
  message?: string;
  holderName?: string;
  holderDescription?: string;
  diameter?: number;
  cornerRadius?: number;
  teethCount?: number;
  toolNumber?: number;
  totalLength?: number;
  cuttingLength?: number;
  /** `tool_work_time` as declared by SolidCAM, omitted when unset or zero. */
  declaredWorkTime?: string;
}

/** Empty and `0:00:00` work times mean "SolidCAM did not estimate this". */
const EMPTY_WORK_TIMES = new Set(['', '0:00:00']);

function readWorkTime(data: EventFields): string | undefined {
  const value = data.tool_work_time;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return EMPTY_WORK_TIMES.has(trimmed) ? undefined : trimmed;
}

/**
 * Collects one entry per distinct `tool_id_string`, keeping the first
 * occurrence and preserving trace order.
 */
export function extractToolCatalog(events: EventData[]): ToolCatalogEntry[] {
  const tools = new Map<string, ToolCatalogEntry>();

  for (const event of events) {
    if (event._eventName !== 'DefTool') continue;
    const data = fieldsOf(event);
    const toolIdString = readString(data, 'tool_id_string');
    if (!toolIdString || tools.has(toolIdString)) continue;

    tools.set(toolIdString, {
      toolIdString,
      name: readString(data, 'tool_name'),
      description: readString(data, 'tool_description'),
      type: readString(data, 'tool_type'),
      userType: readString(data, 'tool_user_type'),
      message: readString(data, 'tool_message'),
      holderName: readString(data, 'holder_name'),
      holderDescription: readString(data, 'holder_description'),
      diameter: readNumber(data, 'tool_diameter'),
      cornerRadius: readNumber(data, 'corner_radius'),
      teethCount: readNumber(data, 'tool_teeth_number'),
      toolNumber: readNumber(data, 'tool_number'),
      totalLength: readNumber(data, 'total_tool_length'),
      cuttingLength: readNumber(data, 'cutting_tool_length'),
      declaredWorkTime: readWorkTime(data),
    });
  }

  return [...tools.values()];
}
