import { describe, expect, it } from 'bun:test';
import type { EventData } from './parser';
import {
  parseSetupSelection,
  partitionSetups,
  selectSetupEvents,
} from './setup-selection';

function makeEvents(list: Record<string, unknown>[]): EventData[] {
  return list as unknown as EventData[];
}

/** Names the events in order, so a slice can be asserted as a whole. */
function names(events: EventData[]): string[] {
  return events.map((event) => String(event._eventName));
}

function tools(events: EventData[]): (string | undefined)[] {
  return events
    .filter((event) => event._eventName === 'DefTool')
    .map((event) => event.tool_id_string as string | undefined);
}

/**
 * The shape every fixture has: shared prologue, three self-contained setups,
 * shared epilogue.
 */
function threeSetupProgram(): Record<string, unknown>[] {
  return [
    { _eventName: 'StartOfFile', part_name: 'PART' },
    { _eventName: 'DefTool', tool_id_string: 'END12', tool_number: 1 },
    { _eventName: 'DefTool', tool_id_string: 'DRILL6', tool_number: 2 },
    { _eventName: 'DefTool', tool_id_string: 'TAP8', tool_number: 3 },
    { _eventName: 'StartProgram' },

    { _eventName: 'Setup', setup_name: 'Setup1' },
    { _eventName: 'HomeNumber', home_number: 530 },
    { _eventName: 'ChangeTool', tool_id_string: 'END12' },
    { _eventName: 'StartOfJob', job_name: 'iRough' },
    { _eventName: 'EndOfJob' },

    { _eventName: 'Setup', setup_name: 'Setup2' },
    { _eventName: 'HomeNumber', home_number: 531 },
    { _eventName: 'ChangeTool', tool_id_string: 'DRILL6' },
    { _eventName: 'StartOfJob', job_name: 'D-drill1' },
    { _eventName: 'EndOfJob' },
    { _eventName: 'StartOfJob', job_name: 'D-drill2' },
    { _eventName: 'EndOfJob' },

    { _eventName: 'Setup', setup_name: 'Setup3' },
    { _eventName: 'HomeNumber', home_number: 532 },
    { _eventName: 'ChangeTool', tool_id_string: 'TAP8' },
    { _eventName: 'StartOfJob', job_name: 'THM-drill' },
    { _eventName: 'EndOfJob' },

    { _eventName: 'EndProgram' },
    { _eventName: 'PlaneData' },
    { _eventName: 'EndOfFile' },
  ];
}

describe('partitionSetups', () => {
  it('splits a program into prologue, one span per setup, and epilogue', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const partition = partitionSetups(events);

    // Assert
    expect(partition.prologueEnd).toBe(5);
    expect(partition.epilogueStart).toBe(22);
    expect(partition.hasImplicitSetup).toBe(false);
    expect(partition.spans).toEqual([
      { index: 1, name: 'Setup1', start: 5, end: 10, jobCount: 1 },
      { index: 2, name: 'Setup2', start: 10, end: 17, jobCount: 2 },
      { index: 3, name: 'Setup3', start: 17, end: 22, jobCount: 1 },
    ]);
  });

  it('reports no spans when the trace has no setup events', () => {
    // Arrange
    const events = makeEvents([
      { _eventName: 'StartOfFile' },
      { _eventName: 'StartOfJob', job_name: 'only' },
      { _eventName: 'EndOfFile' },
    ]);

    // Act
    const partition = partitionSetups(events);

    // Assert
    expect(partition.spans).toEqual([]);
    expect(partition.prologueEnd).toBe(3);
    expect(partition.epilogueStart).toBe(3);
    expect(partition.hasImplicitSetup).toBe(false);
  });

  it('flags jobs that run before the first setup as an implicit setup', () => {
    // Arrange
    const events = makeEvents([
      { _eventName: 'StartOfFile' },
      { _eventName: 'StartOfJob', job_name: 'orphan' },
      { _eventName: 'Setup', setup_name: 'Setup2' },
      { _eventName: 'StartOfJob', job_name: 'real' },
      { _eventName: 'EndProgram' },
    ]);

    // Act
    const partition = partitionSetups(events);

    // Assert
    expect(partition.hasImplicitSetup).toBe(true);
    expect(partition.prologueEnd).toBe(2);
    expect(partition.spans).toHaveLength(1);
    expect(partition.spans[0].index).toBe(1);
  });

  it('numbers unnamed setups the way the timing report does', () => {
    // Arrange — an implicit leading setup shifts the positional fallback.
    const events = makeEvents([
      { _eventName: 'StartOfJob', job_name: 'orphan' },
      { _eventName: 'Setup' },
      { _eventName: 'Setup' },
      { _eventName: 'EndProgram' },
    ]);

    // Act
    const partition = partitionSetups(events);

    // Assert
    expect(partition.spans.map((span) => span.name)).toEqual([
      'Setup2',
      'Setup3',
    ]);
  });

  it('runs the last span to the end when the trace has no end_program', () => {
    // Arrange
    const events = makeEvents([
      { _eventName: 'StartOfFile' },
      { _eventName: 'Setup', setup_name: 'Setup1' },
      { _eventName: 'StartOfJob', job_name: 'a' },
    ]);

    // Act
    const partition = partitionSetups(events);

    // Assert
    expect(partition.epilogueStart).toBe(3);
    expect(partition.spans[0].end).toBe(3);
  });
});

describe('parseSetupSelection', () => {
  const spans = partitionSetups(makeEvents(threeSetupProgram())).spans;

  it('resolves a comma-separated index list', () => {
    expect(parseSetupSelection('1,3', spans)).toEqual([1, 3]);
  });

  it('expands an inclusive range', () => {
    expect(parseSetupSelection('1-3', spans)).toEqual([1, 2, 3]);
  });

  it('mixes indices, ranges, and names and returns them sorted and unique', () => {
    expect(parseSetupSelection('3, 1-2 , Setup1', spans)).toEqual([1, 2, 3]);
  });

  it('tolerates surrounding whitespace and trailing commas', () => {
    expect(parseSetupSelection(' 2 , ', spans)).toEqual([2]);
  });

  it('throws with the available setups when an index is out of range', () => {
    expect(() => parseSetupSelection('9', spans)).toThrow(
      /out of range.*Setup1.*Setup2.*Setup3/s,
    );
  });

  it('throws when a range end is out of range', () => {
    expect(() => parseSetupSelection('2-5', spans)).toThrow(/out of range/);
  });

  it('throws when a range runs backwards', () => {
    expect(() => parseSetupSelection('3-1', spans)).toThrow(/runs backwards/);
  });

  it('throws on an unknown setup name', () => {
    expect(() => parseSetupSelection('Roughing', spans)).toThrow(
      /Unknown setup 'Roughing'/,
    );
  });

  it('throws on an empty selection', () => {
    expect(() => parseSetupSelection('  ,  ', spans)).toThrow(
      /Empty setup selection/,
    );
  });

  it('refuses a name that matches more than one setup', () => {
    // Arrange
    const ambiguous = partitionSetups(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'Op' },
        { _eventName: 'Setup', setup_name: 'Op' },
        { _eventName: 'EndProgram' },
      ]),
    ).spans;

    // Act + Assert
    expect(() => parseSetupSelection('Op', ambiguous)).toThrow(
      /matches 2 setups/,
    );
  });

  it('refuses a token that is both an index and a setup name', () => {
    // Arrange
    const collides = partitionSetups(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'A' },
        { _eventName: 'Setup', setup_name: '1' },
        { _eventName: 'EndProgram' },
      ]),
    ).spans;

    // Act + Assert
    expect(() => parseSetupSelection('1', collides)).toThrow(/ambiguous/);
  });

  it('throws when the trace has no setups at all', () => {
    expect(() => parseSetupSelection('1', [])).toThrow(/no @setup events/);
  });
});

describe('selectSetupEvents', () => {
  it('keeps the prologue, the chosen span, and the epilogue', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const result = selectSetupEvents(events, [2]);

    // Assert
    expect(names(result.events)).toEqual([
      'StartOfFile',
      'DefTool',
      'StartProgram',
      'Setup',
      'HomeNumber',
      'ChangeTool',
      'StartOfJob',
      'EndOfJob',
      'StartOfJob',
      'EndOfJob',
      'EndProgram',
      'PlaneData',
      'EndOfFile',
    ]);
    expect(result.selected.map((span) => span.name)).toEqual(['Setup2']);
  });

  it('emits setups in trace order regardless of selection order', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const result = selectSetupEvents(events, [3, 1]);

    // Assert
    const setups = result.events.filter(
      (event) => event._eventName === 'Setup',
    );
    expect(setups.map((event) => event.setup_name)).toEqual([
      'Setup1',
      'Setup3',
    ]);
  });

  it('prunes tool definitions no selected setup loads', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const result = selectSetupEvents(events, [2]);

    // Assert
    expect(tools(result.events)).toEqual(['DRILL6']);
    expect(result.warnings.join(' ')).toMatch(/Dropped 2 tool definition\(s\)/);
  });

  it('keeps the whole tool table when pruning is disabled', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const result = selectSetupEvents(events, [2], { pruneTools: false });

    // Assert
    expect(tools(result.events)).toEqual(['END12', 'DRILL6', 'TAP8']);
  });

  it('keeps a tool definition it cannot identify', () => {
    // Arrange
    const events = makeEvents([
      { _eventName: 'StartOfFile' },
      { _eventName: 'DefTool', tool_number: 7 },
      { _eventName: 'Setup', setup_name: 'Setup1' },
      { _eventName: 'ChangeTool', tool_id_string: 'END12' },
      { _eventName: 'StartOfJob', job_name: 'a' },
      { _eventName: 'EndProgram' },
    ]);

    // Act
    const result = selectSetupEvents(events, [1]);

    // Assert
    expect(tools(result.events)).toEqual([undefined]);
  });

  it('returns every setup unchanged when all of them are selected', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const result = selectSetupEvents(events, [1, 2, 3], {
      pruneTools: false,
    });

    // Assert
    expect(result.events).toEqual(events);
  });

  it('warns that a setup posted without its predecessor starts from defaults', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const result = selectSetupEvents(events, [2], { pruneTools: false });

    // Assert
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(
      /Setup 2 \('Setup2'\) is posted without setup 1 in front of it/,
    );
  });

  it('warns once per gap in the selection, not once per setup', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const result = selectSetupEvents(events, [1, 3], { pruneTools: false });

    // Assert — setup 1 leads the program and needs nothing; setup 3 lost setup 2.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Setup 3 \('Setup3'\)/);
  });

  it('stays quiet when the selection is an unbroken run from the first setup', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act
    const result = selectSetupEvents(events, [1, 2], { pruneTools: false });

    // Assert
    expect(result.warnings).toEqual([]);
  });

  it('calls out a setup that also opens without a tool change of its own', () => {
    // Arrange
    const events = makeEvents([
      { _eventName: 'StartOfFile' },
      { _eventName: 'DefTool', tool_id_string: 'END12' },
      { _eventName: 'Setup', setup_name: 'Setup1' },
      { _eventName: 'ChangeTool', tool_id_string: 'END12' },
      { _eventName: 'StartOfJob', job_name: 'a' },
      { _eventName: 'Setup', setup_name: 'Setup2' },
      { _eventName: 'StartOfJob', job_name: 'b' },
      { _eventName: 'EndProgram' },
    ]);

    // Act
    const result = selectSetupEvents(events, [2], { pruneTools: false });

    // Assert
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[1]).toMatch(
      /also starts a job before any tool change of its own/,
    );
  });

  it('rejects an out-of-range index', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act + Assert
    expect(() => selectSetupEvents(events, [4])).toThrow(/out of range/);
  });

  it('rejects an empty selection', () => {
    // Arrange
    const events = makeEvents(threeSetupProgram());

    // Act + Assert
    expect(() => selectSetupEvents(events, [])).toThrow(
      /Empty setup selection/,
    );
  });

  it('rejects a trace with no setups', () => {
    // Arrange
    const events = makeEvents([{ _eventName: 'StartOfFile' }]);

    // Act + Assert
    expect(() => selectSetupEvents(events, [1])).toThrow(/no @setup events/);
  });
});
