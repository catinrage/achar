import { fieldsOf, readString } from './event-fields';
import type { EventData } from './parser';

/**
 * Selecting a subset of a trace's setups.
 *
 * A Trace 5 program is strictly linear and self-delimiting: a shared prologue
 * (`start_of_file`, the `def_tool` table, `start_program`), then one contiguous
 * span per `@setup`, then a shared epilogue (`end_program` onwards). A setup is
 * therefore a slice of the event array, and posting a subset is a pure array
 * operation performed before the events reach a `Program`.
 *
 * Doing it here rather than in a post keeps every post setup-blind — the
 * Siemens post still ignores the `Setup` event entirely — and means a future
 * controller inherits the feature for free. It also has to be done here: the
 * Builder shares one N-number counter across every generated file, so the main
 * MPF's block numbers advance in step with the subprogram bodies. Cutting lines
 * out of finished G-code would leave gaps; the program must be re-generated
 * from a shorter event stream.
 */

export interface SetupSpan {
  /** 1-based, and the address the user types. */
  index: number;
  /** `setup_name`, or the same positional fallback `extractTimingReport` uses. */
  name: string;
  /** Index of the `Setup` event that opens the span. */
  start: number;
  /** Exclusive. */
  end: number;
  jobCount: number;
}

export interface SetupPartition {
  /** Events `[0, prologueEnd)` are shared by every setup. */
  prologueEnd: number;
  spans: SetupSpan[];
  /** Events `[epilogueStart, length)` are shared by every setup. */
  epilogueStart: number;
  /**
   * True when jobs appear before the first `@setup`. Those jobs live in the
   * prologue and are always emitted, and `extractTimingReport` reports them as
   * a leading implicit setup — so its `setups[]` carries one entry more than
   * `spans` whenever this is set.
   */
  hasImplicitSetup: boolean;
}

export interface SelectSetupEventsOptions {
  /**
   * Drop `DefTool` events for tools no selected setup ever loads, so the
   * "Tools Used In This Program" comment and the tool-measurement program
   * describe the run the operator is about to make. Defaults to true.
   */
  pruneTools?: boolean;
  /** Reuse an already-computed partition instead of walking the events again. */
  partition?: SetupPartition;
}

export interface SetupSelectionResult {
  events: EventData[];
  /** Non-fatal findings the caller is expected to surface. */
  warnings: string[];
  selected: SetupSpan[];
}

/**
 * Splits a parsed trace into its shared prologue, its per-setup spans, and its
 * shared epilogue. Never throws: a trace with no `@setup` at all is one big
 * prologue with zero spans.
 */
export function partitionSetups(events: EventData[]): SetupPartition {
  const starts: number[] = [];
  let firstJob = -1;
  let endProgram = -1;

  for (let index = 0; index < events.length; index++) {
    const name = events[index]._eventName;
    if (name === 'Setup') starts.push(index);
    else if (name === 'StartOfJob' && firstJob === -1) firstJob = index;
    else if (name === 'EndProgram' && endProgram === -1) endProgram = index;
  }

  if (starts.length === 0) {
    return {
      prologueEnd: events.length,
      spans: [],
      epilogueStart: events.length,
      hasImplicitSetup: false,
    };
  }

  const prologueEnd = starts[0];
  const hasImplicitSetup = firstJob !== -1 && firstJob < prologueEnd;
  const lastStart = starts[starts.length - 1];
  // The epilogue opens at `end_program`, but only the one that closes the last
  // setup. A trace without it simply has no epilogue.
  const epilogueStart =
    endProgram > lastStart
      ? endProgram
      : findEventFrom(events, 'EndProgram', lastStart);

  const spans = starts.map((start, position) => {
    const end = starts[position + 1] ?? epilogueStart;
    return {
      index: position + 1,
      start,
      end,
      name: setupName(events[start], position, hasImplicitSetup),
      jobCount: countEvents(events, 'StartOfJob', start, end),
    };
  });

  return { prologueEnd, spans, epilogueStart, hasImplicitSetup };
}

/**
 * Resolves a user-typed selection such as `1,3,5`, `1-3,7`, or `Setup1,Setup3`
 * into sorted, de-duplicated 1-based indices.
 *
 * Names are accepted for convenience but resolve to indices, and a name that
 * matches more than one span is a hard error: SolidCAM does not guarantee
 * `setup_name` is unique, which is why `extractProductProfile` reports
 * `duplicate-setup-name` and the HTTP docs tell consumers to key on the index.
 * Guessing which of two identically named setups to post is not a decision this
 * function is entitled to make.
 */
export function parseSetupSelection(
  spec: string,
  spans: SetupSpan[],
): number[] {
  if (spans.length === 0) {
    throw new Error('This trace contains no @setup events; nothing to select.');
  }

  const tokens = spec
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new Error(`Empty setup selection. ${availableSetups(spans)}`);
  }

  const selected = new Set<number>();
  for (const token of tokens) {
    for (const index of resolveToken(token, spans)) {
      selected.add(index);
    }
  }

  return [...selected].sort((left, right) => left - right);
}

/**
 * Rebuilds an event stream containing only the selected setups, keeping the
 * shared prologue and epilogue that every setup depends on.
 *
 * Setups are emitted in trace order regardless of the order they were selected
 * in: the machine runs them in the order the part was programmed, and re-
 * ordering them would silently produce a program nobody asked for.
 */
export function selectSetupEvents(
  events: EventData[],
  selection: number[],
  options: SelectSetupEventsOptions = {},
): SetupSelectionResult {
  const partition = options.partition ?? partitionSetups(events);
  const { spans } = partition;

  if (spans.length === 0) {
    throw new Error('This trace contains no @setup events; nothing to select.');
  }

  const wanted = new Set(selection);
  for (const index of wanted) {
    if (index < 1 || index > spans.length) {
      throw new Error(
        `Setup ${index} is out of range. ${availableSetups(spans)}`,
      );
    }
  }
  if (wanted.size === 0) {
    throw new Error(`Empty setup selection. ${availableSetups(spans)}`);
  }

  const selected = spans.filter((span) => wanted.has(span.index));
  const kept = [
    ...events.slice(0, partition.prologueEnd),
    ...selected.flatMap((span) => events.slice(span.start, span.end)),
    ...events.slice(partition.epilogueStart),
  ];

  const warnings = inheritedStateWarnings(events, selected, wanted);

  if (options.pruneTools === false) {
    return { events: kept, warnings, selected };
  }

  const used = toolsUsedIn(events, selected);
  const pruned = kept.filter(
    (event) => event._eventName !== 'DefTool' || isToolUsed(event, used),
  );
  const dropped = kept.length - pruned.length;
  if (dropped > 0) {
    warnings.push(
      `Dropped ${dropped} tool definition(s) for tools no selected setup loads. ` +
        'Pass --keep-all-tools to keep the full tool table.',
    );
  }

  return { events: pruned, warnings, selected };
}

/** Renders the pickable setups for an error message. */
export function availableSetups(spans: SetupSpan[]): string {
  const listed = spans.map((span) => `${span.index} (${span.name})`).join(', ');
  return `Available setups: ${listed}.`;
}

function resolveToken(token: string, spans: SetupSpan[]): number[] {
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
  const numeric = /^\d+$/.test(token);
  const named = spans.filter((span) => span.name === token);

  // A setup literally named "2" or "1-3" would make the token mean two things.
  // Rather than pick, say so — the user can rename or select the other way.
  if (named.length > 0 && (numeric || range)) {
    throw new Error(
      `'${token}' is ambiguous: it is both a setup index and the name of setup ` +
        `${named.map((span) => span.index).join(', ')}. ${availableSetups(spans)}`,
    );
  }

  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from > to) {
      throw new Error(
        `Setup range '${token}' runs backwards. Write it as ${to}-${from}.`,
      );
    }
    assertInRange(from, spans, token);
    assertInRange(to, spans, token);
    return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
  }

  if (numeric) {
    const index = Number(token);
    assertInRange(index, spans, token);
    return [index];
  }

  if (named.length > 1) {
    throw new Error(
      `Setup name '${token}' matches ${named.length} setups ` +
        `(${named.map((span) => span.index).join(', ')}); ` +
        'setup names are not unique in this trace, so select by index instead. ' +
        availableSetups(spans),
    );
  }
  if (named.length === 1) return [named[0].index];

  throw new Error(`Unknown setup '${token}'. ${availableSetups(spans)}`);
}

function assertInRange(index: number, spans: SetupSpan[], token: string): void {
  if (index >= 1 && index <= spans.length) return;
  throw new Error(
    `Setup ${index} in '${token}' is out of range. ${availableSetups(spans)}`,
  );
}

/**
 * Warns about every selected setup that no longer has its predecessor in front
 * of it.
 *
 * The post is a modal state machine: it emits only what changed since the last
 * event. A setup that is not the first one in the program inherits real values
 * from the setup before it — most consequentially the cutting tolerance, which
 * `siemens828dPolicy.cycleTolerance` carries forward whenever a job does not
 * state its own `Cut_tolerance`, and the modal G-groups and last position that
 * decide whether a move is written out in full. Post that setup on its own and
 * the post starts from program defaults instead, so its first job can differ
 * from the same job in a full run. The program is valid and self-consistent —
 * it is just not a byte-slice of the whole one, and the operator should know
 * which job to look at.
 *
 * A setup that also opens without a tool change of its own is called out
 * specifically: that one can pick up the wrong tool entirely, through the
 * remembered `ChangeTool` a `used_in_transform_translate` job reuses and the
 * tool named in the job header comment.
 */
function inheritedStateWarnings(
  events: EventData[],
  selected: SetupSpan[],
  wanted: Set<number>,
): string[] {
  const warnings: string[] = [];

  for (const span of selected) {
    if (span.index === 1 || wanted.has(span.index - 1)) continue;

    warnings.push(
      `Setup ${span.index} ('${span.name}') is posted without setup ` +
        `${span.index - 1} in front of it, so it starts from program defaults ` +
        'rather than the state that setup left behind. Its first job may differ ' +
        'from a full run — check the cutting tolerance and the first ' +
        'rapid move.',
    );

    if (!opensWithToolChange(events, span)) {
      warnings.push(
        `Setup ${span.index} ('${span.name}') also starts a job before any ` +
          'tool change of its own. Check which tool its first job calls.',
      );
    }
  }

  return warnings;
}

/** True when the span loads a tool before it starts machining. */
function opensWithToolChange(events: EventData[], span: SetupSpan): boolean {
  for (let index = span.start; index < span.end; index++) {
    const name = events[index]._eventName;
    if (name === 'ChangeTool') return true;
    if (name === 'StartOfJob') return false;
  }
  return true;
}

function toolsUsedIn(events: EventData[], spans: SetupSpan[]): Set<string> {
  const used = new Set<string>();
  for (const span of spans) {
    for (let index = span.start; index < span.end; index++) {
      const event = events[index];
      if (event._eventName !== 'ChangeTool') continue;
      const tool = readString(fieldsOf(event), 'tool_id_string');
      if (tool) used.add(tool);
    }
  }
  return used;
}

/** A definition Achar cannot identify is kept: pruning is never a guess. */
function isToolUsed(event: EventData, used: Set<string>): boolean {
  const tool = readString(fieldsOf(event), 'tool_id_string');
  return tool === undefined || used.has(tool);
}

function setupName(
  event: EventData,
  position: number,
  hasImplicitSetup: boolean,
): string {
  const declared = readString(fieldsOf(event), 'setup_name');
  if (declared !== undefined) return declared;
  // Matches the positional fallback in `extractTimingReport`, which counts the
  // implicit leading setup when the trace has one.
  return `Setup${position + 1 + (hasImplicitSetup ? 1 : 0)}`;
}

function findEventFrom(
  events: EventData[],
  name: EventData['_eventName'],
  from: number,
): number {
  for (let index = from; index < events.length; index++) {
    if (events[index]._eventName === name) return index;
  }
  return events.length;
}

function countEvents(
  events: EventData[],
  name: EventData['_eventName'],
  from: number,
  to: number,
): number {
  let count = 0;
  for (let index = from; index < to; index++) {
    if (events[index]._eventName === name) count++;
  }
  return count;
}
