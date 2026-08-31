import { describe, expect, it } from 'bun:test';
import type { EventData } from './parser';
import type { ProductProfileDiagnosticCode } from './product-profile';
import { extractProductProfile, readTracePostedAt } from './product-profile';

function makeEvents(list: Record<string, unknown>[]): EventData[] {
  return list as unknown as EventData[];
}

function codes(
  profile: ReturnType<typeof extractProductProfile>,
): ProductProfileDiagnosticCode[] {
  return profile.diagnostics.map((diagnostic) => diagnostic.code);
}

/** A minimal but fully timed two-setup program. */
function timedProgram(): Record<string, unknown>[] {
  return [
    {
      _eventName: 'StartOfFile',
      part_name: '2541021_CAM_MILLING',
      part_model_name: 'C:\\models\\part.SLDASM',
      program_number: 1000,
      imachining_material_name: 'Aluminum_120BHN-69HRB',
      inch_system: 0,
      stock_type: 0,
      stock_x: 357.643,
      stock_y: 36.327,
      stock_z: 337.887,
      target_x: 239.618,
      target_y: 240.253,
      target_z: 329,
    },
    {
      _eventName: 'Setup',
      setup_name: 'Setup1',
      fixture_name: 'Fixture',
      part_home_number: 1,
    },
    {
      _eventName: 'DefTool',
      tool_id_string: 'END12Z3AL',
      tool_name: 'EM12',
      tool_diameter: 12,
      tool_work_time: '  0:03:44',
    },
    { _eventName: 'ChangeTool', tool_id_string: 'END12Z3AL' },
    { _eventName: 'StartOfJob', job_name: 'iRough', job_time: '0:02:00' },
    { _eventName: 'StartOfJob', job_name: 'iRough-walls', job_time: '0:01:44' },
    {
      _eventName: 'Setup',
      setup_name: 'Setup2',
      fixture_name: 'Vise',
      part_home_number: 2,
    },
    { _eventName: 'StartOfJob', job_name: 'Finish', job_time: '0:01:00' },
  ];
}

describe('extractProductProfile', () => {
  /**
   * The trap this phase was built around. `extractProductProfile` folds four
   * aggregations; if any of them walked the events separately, a generator
   * would be exhausted by the first and the rest would return empty — with no
   * error, and with a result that still looks like a profile. Arrays re-iterate,
   * so an array-fed test cannot catch it. This one feeds a real generator.
   */
  it('produces the same profile from a single-use stream as from an array', () => {
    // Arrange
    const list = makeEvents(timedProgram());
    function* stream(): Generator<EventData> {
      yield* list;
    }

    // Act
    const fromArray = extractProductProfile(list);
    const fromStream = extractProductProfile(stream());

    // Assert
    expect(fromStream).toEqual(fromArray);
    expect(fromStream.tools.length).toBeGreaterThan(0);
    expect(fromStream.setups.length).toBeGreaterThan(0);
    expect(fromStream.part.name).toBe(fromArray.part.name);
    expect(fromStream.eventCount).toBe(list.length);
  });

  it('summarizes part, setups, tools, and totals', () => {
    const profile = extractProductProfile(makeEvents(timedProgram()));

    expect(profile.part).toEqual({
      name: '2541021_CAM_MILLING',
      modelName: 'C:\\models\\part.SLDASM',
      programNumber: 1000,
      materialName: 'Aluminum_120BHN-69HRB',
      inchSystem: false,
      stockType: 0,
      stock: { x: 357.643, y: 36.327, z: 337.887 },
      target: { x: 239.618, y: 240.253, z: 329 },
    });

    expect(profile.setups).toHaveLength(2);
    expect(profile.setups[0].name).toBe('Setup1');
    expect(profile.setups[0].fixtureName).toBe('Fixture');
    expect(profile.setups[0].partHomeNumber).toBe(1);
    expect(profile.setups[0].duration).toBe('0:03:44');
    expect(profile.setups[0].tools).toEqual([
      { tool: 'END12Z3AL', seconds: 224, duration: '0:03:44', jobInstances: 2 },
    ]);
    expect(profile.setups[1].fixtureName).toBe('Vise');

    expect(profile.tools).toHaveLength(1);
    expect(profile.tools[0]).toMatchObject({
      toolIdString: 'END12Z3AL',
      name: 'EM12',
      diameter: 12,
      seconds: 284,
      duration: '0:04:44',
      jobInstances: 3,
    });

    expect(profile.totals).toEqual({ seconds: 284, duration: '0:04:44' });
    expect(profile.eventCount).toBe(8);
    expect(profile.diagnostics).toEqual([]);
  });

  it('never includes the event array', () => {
    const profile = extractProductProfile(makeEvents(timedProgram()));
    expect(Object.keys(profile).sort()).toEqual([
      'diagnostics',
      'eventCount',
      'part',
      'setups',
      'tools',
      'totals',
    ]);
  });

  it('keeps material and fixture strings verbatim', () => {
    const profile = extractProductProfile(
      makeEvents([
        {
          _eventName: 'StartOfFile',
          imachining_material_name: 'ST 52-3 / 1.0570',
        },
        { _eventName: 'Setup', setup_name: 'S1', fixture_name: 'گیره ۳' },
        { _eventName: 'ChangeTool', tool_id_string: 'T1' },
        { _eventName: 'StartOfJob', job_name: 'J', job_time: '0:01:00' },
      ]),
    );

    expect(profile.part.materialName).toBe('ST 52-3 / 1.0570');
    expect(profile.setups[0].fixtureName).toBe('گیره ۳');
  });

  it('returns an empty part when the trace has no start_of_file', () => {
    const profile = extractProductProfile(
      makeEvents([{ _eventName: 'Setup', setup_name: 'S1' }]),
    );
    expect(profile.part).toEqual({});
  });

  it('omits stock and target when the trace has no dimensions', () => {
    const profile = extractProductProfile(
      makeEvents([{ _eventName: 'StartOfFile', part_name: 'P' }]),
    );
    expect(profile.part.stock).toBeUndefined();
    expect(profile.part.target).toBeUndefined();
  });

  it('reports tools that ran without a matching def_tool', () => {
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'S1' },
        { _eventName: 'ChangeTool', tool_id_string: 'UNDECLARED' },
        { _eventName: 'StartOfJob', job_name: 'J', job_time: '0:01:00' },
      ]),
    );

    expect(profile.tools).toEqual([
      {
        toolIdString: 'UNDECLARED',
        seconds: 60,
        duration: '0:01:00',
        jobInstances: 1,
      },
    ]);
  });

  it('gives defined-but-unused tools zero time and sorts heaviest first', () => {
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'S1' },
        {
          _eventName: 'DefTool',
          tool_id_string: 'IDLE',
          tool_work_time: '0:05:00',
        },
        {
          _eventName: 'DefTool',
          tool_id_string: 'USED',
          tool_work_time: '0:01:00',
        },
        { _eventName: 'ChangeTool', tool_id_string: 'USED' },
        { _eventName: 'StartOfJob', job_name: 'J', job_time: '0:01:00' },
      ]),
    );

    expect(profile.tools.map((tool) => tool.toolIdString)).toEqual([
      'USED',
      'IDLE',
    ]);
    expect(profile.tools[1]).toMatchObject({
      seconds: 0,
      duration: '0:00:00',
      jobInstances: 0,
    });
  });
});

describe('extractProductProfile diagnostics', () => {
  it('errors when no job carries a time estimate', () => {
    // The PROJECT_2551019 shape: structurally valid, posted without SolidCAM
    // time estimation, so every job_time and tool_work_time is blank or zero.
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'Setup1' },
        {
          _eventName: 'DefTool',
          tool_id_string: 'END6Z4',
          tool_work_time: '  0:00:00',
        },
        { _eventName: 'ChangeTool', tool_id_string: 'END6Z4' },
        { _eventName: 'StartOfJob', job_name: 'iRough', job_time: '' },
      ]),
    );

    const diagnostic = profile.diagnostics.find(
      (entry) => entry.code === 'no-timing-data',
    );
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.message).toContain('time estimation');
    expect(profile.totals.seconds).toBe(0);
  });

  it('errors when every declared tool work time is empty or zero', () => {
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'Setup1' },
        { _eventName: 'DefTool', tool_id_string: 'A', tool_work_time: '' },
        { _eventName: 'ChangeTool', tool_id_string: 'A' },
        { _eventName: 'StartOfJob', job_name: 'J', job_time: '0:10:00' },
      ]),
    );

    expect(codes(profile)).toContain('no-timing-data');
  });

  it('does not error when a trace has timing but declares no tools at all', () => {
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'Setup1' },
        { _eventName: 'ChangeTool', tool_id_string: 'A' },
        { _eventName: 'StartOfJob', job_name: 'J', job_time: '0:10:00' },
      ]),
    );

    expect(codes(profile)).not.toContain('no-timing-data');
  });

  it('warns when the trace declares no setups', () => {
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'ChangeTool', tool_id_string: 'A' },
        { _eventName: 'StartOfJob', job_name: 'J', job_time: '0:01:00' },
      ]),
    );

    const diagnostic = profile.diagnostics.find(
      (entry) => entry.code === 'no-setups',
    );
    expect(diagnostic?.severity).toBe('warning');
    expect(profile.setups[0].name).toBe('(no setup)');
    expect(profile.setups[0].fixtureName).toBeUndefined();
  });

  it('warns about a setup with no time while others have time', () => {
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'Busy' },
        { _eventName: 'ChangeTool', tool_id_string: 'A' },
        { _eventName: 'StartOfJob', job_name: 'J', job_time: '0:01:00' },
        { _eventName: 'Setup', setup_name: 'Idle' },
      ]),
    );

    const diagnostic = profile.diagnostics.find(
      (entry) => entry.code === 'empty-setup',
    );
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.message).toContain('Idle');
  });

  it('does not warn about empty setups when the whole trace is untimed', () => {
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'A' },
        { _eventName: 'Setup', setup_name: 'B' },
      ]),
    );

    expect(codes(profile)).toEqual(['no-timing-data']);
  });

  it('warns once per duplicated setup name', () => {
    const profile = extractProductProfile(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'Setup1' },
        { _eventName: 'ChangeTool', tool_id_string: 'A' },
        { _eventName: 'StartOfJob', job_name: 'J', job_time: '0:01:00' },
        { _eventName: 'Setup', setup_name: 'Setup1' },
        { _eventName: 'StartOfJob', job_name: 'K', job_time: '0:01:00' },
        { _eventName: 'Setup', setup_name: 'Setup1' },
        { _eventName: 'StartOfJob', job_name: 'L', job_time: '0:01:00' },
      ]),
    );

    const duplicates = profile.diagnostics.filter(
      (entry) => entry.code === 'duplicate-setup-name',
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].message).toContain('Setup1');
  });

  it('reports no diagnostics for a healthy trace', () => {
    expect(
      extractProductProfile(makeEvents(timedProgram())).diagnostics,
    ).toEqual([]);
  });
});

describe('trace post timestamp', () => {
  const header = (date: string) =>
    [
      '(1)@start_of_file   ==> build_revision:152076',
      '(3)@usr_US_date     ==> ',
      '                      > N20 ; Author \t\t: ABDOLLAH ',
      `                      > N30 ; Date \t\t: ${date} `,
    ].join('\n');

  it('reads the stamp the post writes into its own output', () => {
    // No event carries a timestamp; this line is the only record of when a
    // trace was produced, which is what makes a stale upload detectable.
    expect(readTracePostedAt(header('AUG-31-2026-9:25:37AM'))).toEqual({
      raw: 'AUG-31-2026-9:25:37AM',
      iso: '2026-08-31T09:25:37',
    });
  });

  it('handles the forms real posts emit', () => {
    // Space-padded day, and the two hours where 12-hour time is a trap.
    expect(readTracePostedAt(header('JUL- 7-2026-6:25:04PM'))?.iso).toBe(
      '2026-07-07T18:25:04',
    );
    expect(readTracePostedAt(header('JUL-12-2026-12:56:27PM'))?.iso).toBe(
      '2026-07-12T12:56:27',
    );
    expect(readTracePostedAt(header('JAN- 1-2026-12:00:00AM'))?.iso).toBe(
      '2026-01-01T00:00:00',
    );
  });

  it('keeps a stamp it cannot parse rather than dropping it', () => {
    // An operator can still compare an odd format against SolidCAM by eye.
    const read = readTracePostedAt(header('sometime last Tuesday'));

    expect(read).toEqual({ raw: 'sometime last Tuesday' });
  });

  it('reports nothing for a trace with no stamp', () => {
    expect(readTracePostedAt('(1)@start_of_file   ==> x:1')).toBeUndefined();
  });

  it('does not scan the whole file for it', () => {
    // The stamp is in the program header. Searching a 60 MB trace for one
    // that is not there would cost more than the analysis it belongs to.
    const buried = `${'; filler\n'.repeat(2000)}${header('AUG-31-2026-9:25:37AM')}`;

    expect(readTracePostedAt(buried)).toBeUndefined();
  });
});
