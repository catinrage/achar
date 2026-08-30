import { describe, expect, it } from 'bun:test';
import { EVENT_NAMES, isKnownEventName } from '../types';
import { Logger, LogLevel } from './logger';
import { type EventData, Parser } from './parser';

describe('Parser', () => {
  it('should correctly parse a simple start_of_file event', () => {
    const input = `
(0)@start_of_file
gcode_program_number : '1234'
machine_name : 'My CNC'
    `;
    const parser = new Parser(input);
    const result = parser.parse();

    expect(result).toHaveLength(1);
    const event = result[0];
    expect(event._eventName).toBe('StartOfFile');
    expect(event._index).toBe(0);
    expect(event.gcode_program_number).toBe('1234');
    expect(event.machine_name).toBe('My CNC');
  });

  it('should parse multiple events in correct order', () => {
    const input = `
(0)@start_of_file
(1)@tool_change
tool_number : 1
(2)@end_of_file
    `;
    const parser = new Parser(input);
    const result = parser.parse();

    expect(result).toHaveLength(3);
    expect(result[0]._eventName).toBe('StartOfFile');
    expect(result[0]._index).toBe(0);
    expect(result[1]._eventName).toBe('ToolChange');
    expect(result[1]._index).toBe(1);
    expect(result[1].tool_number).toBe(1);
    expect(result[2]._eventName).toBe('EndOfFile');
    expect(result[2]._index).toBe(2);
  });

  it('should correctly parse different data types', () => {
    const input = `
(0)@data_types_test
string_val : 'hello world'
int_val : 123
float_val : 45.67
bool_true : true
bool_false : false
unit_number : 100mm
    `;
    const parser = new Parser(input);
    const event = parser.parse()[0];

    expect(event.string_val).toBe('hello world');
    expect(event.int_val).toBe(123);
    expect(event.float_val).toBe(45.67);
    expect(event.bool_true).toBe(true);
    expect(event.bool_false).toBe(false);
    expect(event.unit_number).toBe(100);
  });

  it('preserves SolidCAM trace change flags', () => {
    const input = `
(0)@line
xpos : 10T
ypos : 20F
feed : 1000T
unit_number : 100mm
    `;
    const event = new Parser(input).parse()[0];

    expect(event.xpos).toBe(10);
    expect(event.xpos__changed).toBe(true);
    expect(event.ypos).toBe(20);
    expect(event.ypos__changed).toBe(false);
    expect(event.feed).toBe(1000);
    expect(event.feed__changed).toBe(true);
    expect(event.unit_number).toBe(100);
    expect(event.unit_number__changed).toBeUndefined();
  });

  it('parses unquoted values containing spaces', () => {
    const input = `
(0)@start_of_job
iWBCM : 2  sWCM_MSG : Salamat Abzar Check Shavad!!  iM1 : 1  sM1_MSG : Is Pocket Left!?  iTC_SUPA_MODE : 0
    `;
    const event = new Parser(input).parse()[0];

    expect(event.iWBCM).toBe(2);
    expect(event.sWCM_MSG).toBe('Salamat Abzar Check Shavad!!');
    expect(event.iM1).toBe(1);
    expect(event.sM1_MSG).toBe('Is Pocket Left!?');
    expect(event.iTC_SUPA_MODE).toBe(0);
  });

  it('preserves precise drill cycle coordinates from trace output', () => {
    const input = `
(1)@drill
drill_clearance_z : 20.000 drill_upper_z : 18.001 drill_lower_z : 12.001
(2)@usr_coolant
  > N100 CYCLE81(20,16.0005,2,12.0005,,0,0,1,12)
    `;
    const drill = new Parser(input)
      .parse()
      .find((event) => event._eventName === 'Drill');

    expect(drill?.cycle_clearance_z_precise).toBe(20);
    expect(drill?.cycle_upper_z_precise).toBe(16.0005);
    expect(drill?.cycle_lower_z_precise).toBe(12.0005);
  });

  it('should correctly parse enum types', () => {
    const input = `
(0)@enum_test
direction : CW
state : ON
plan : XY
    `;
    const parser = new Parser(input);
    const event = parser.parse()[0];

    expect(event.direction).toBe('CW');
    expect(event.state).toBe('ON');
    expect(event.plan).toBe('XY');
  });

  it('should handle an empty input string', () => {
    const input = '';
    // Empty strings are now allowed for edge cases like empty trace files
    const parser = new Parser(input);
    const events = parser.parse();
    expect(events).toHaveLength(0);
  });

  it('should handle input with no valid event blocks', () => {
    const input = `
just some random text
another line without an event
key: value
    `;
    const parser = new Parser(input);
    const result = parser.parse();
    expect(result).toEqual([]);
  });

  it('should handle events with no parameters', () => {
    const input = `
(0)@start_of_file
(1)@end_of_file
    `;
    const parser = new Parser(input);
    const result = parser.parse();

    expect(result).toHaveLength(2);
    expect(result[0]._eventName).toBe('StartOfFile');
    expect(Object.keys(result[0])).toHaveLength(3); // _eventName, _index, _depth
    expect(result[1]._eventName).toBe('EndOfFile');
  });

  it('should handle malformed key-value pairs gracefully', () => {
    // This test checks how the parser handles lines that look like
    // key-value pairs but might be malformed. The current implementation
    // might be greedy, this test will document its behavior.
    const input = `
(0)@malformed_test
key_without_value :
: value_without_key
just_a_word
'quoted_string'
    `;
    const parser = new Parser(input);
    const result = parser.parse();

    // Based on the current regex, these lines will be ignored, which is acceptable.
    // We expect only the event name and index.
    expect(result).toHaveLength(1);
    expect(String(result[0]._eventName)).toBe('MalformedTest');
    expect(Object.keys(result[0])).toHaveLength(3);
  });

  it('should parse a complex, multi-line, real-world-like example', () => {
    const input = `
(0)@start_of_file
  gcode_program_number : '1'
  machine_name : 'HAAS VF3'
  part_units : 'mm'

(1)@tool_change
  tool_number : 2
  tool_name : 'T2 - 10mm End Mill'
  tool_diameter : 10
  clearance_plane : 25mm

(2)@spindle
  speed : 8000
  direction : SPINDLE_CW

(3)@rapid
  x : 10.123
  y : -20.456
  z : 15

(4)@line
  x : 10.123
  y : -20.456
  z : -5
  feed_rate : 1200
  
(5)@arc
  direction : ARC_CW
  end_x : 15
  end_y : -15
  center_x : 12.5615
  center_y : -17.956
  feed_rate : 800

(6)@end_of_file
    `;
    const parser = new Parser(input);
    const result = parser.parse();

    expect(result).toHaveLength(7);

    // Spot check a few events
    const toolChangeEvent = result[1] as EventData<'ToolChange'>;
    expect(toolChangeEvent._eventName).toBe('ToolChange');
    expect(toolChangeEvent.tool_number).toBe(2);
    expect(toolChangeEvent.clearance_plane).toBe(25);

    const lineEvent = result[4] as EventData<'Line'>;
    expect(lineEvent._eventName).toBe('Line');
    expect(lineEvent.x).toBe(10.123);
    expect(lineEvent.z).toBe(-5);
    expect(lineEvent.feed_rate).toBe(1200);

    const arcEvent = result[5] as EventData<'Arc'>;
    expect(arcEvent._eventName).toBe('Arc');
    expect(arcEvent.direction).toBe('ARC_CW');
    expect(arcEvent.center_y).toBe(-17.956);

    expect(result[6]._eventName).toBe('EndOfFile');
  });

  describe('parseEvents', () => {
    /** A drill whose CYCLE line lands several events later, as real traces do. */
    const DELAYED_CYCLE = `
(0)@start_of_file
part_name : 'P'
(1)@drill
drill_upper_z : 10
(1)@line
x : 1
(1)@line
x : 2
(1)@rapid
> N100 CYCLE81(20,16.0005,2,12.0005,,0,0,1,12)
(1)@end_of_file
`;

    it('yields the same events, in the same order, as parse()', () => {
      // Arrange
      const input = `
(0)@start_of_file
part_name : 'Widget'
(1)@setup
setup_name : 'Setup1'
(1)@start_of_job
job_name : 'Rough'
(1)@end_of_file
`;

      // Act
      const streamed = [...new Parser(input).parseEvents()];

      // Assert
      expect(streamed).toEqual(new Parser(input).parse());
    });

    it('is single-use, so a second walk yields nothing', () => {
      // Arrange — the trap this whole design exists to make visible.
      const stream = new Parser(DELAYED_CYCLE).parseEvents();

      // Act
      const first = [...stream];
      const second = [...stream];

      // Assert
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual([]);
    });

    it('applies the retroactive drill cycle when the caller retains events', () => {
      // Arrange + Act — materializing keeps the object the parser writes back to.
      const events = [...new Parser(DELAYED_CYCLE).parseEvents()];
      const drill = events.find((event) => event._eventName === 'Drill');

      // Assert
      expect(drill?.cycle_clearance_z_precise).toBe(20);
      expect(drill?.cycle_lower_z_precise).toBe(12.0005);
    });

    /**
     * The one documented gap. A consumer that reads an event and drops it sees
     * the drill before the trailing `CYCLE81(...)` line writes to it. Pinned
     * here so the gap stays exactly this size: if a future change makes any
     * *other* field depend on a later line, this fails.
     */
    it('shows only the cycle fields missing to a read-and-discard consumer', () => {
      // Arrange
      const retained = new Parser(DELAYED_CYCLE).parse();

      // Act — snapshot each event as it arrives, keeping no reference.
      const snapshots: Record<string, unknown>[] = [];
      for (const event of new Parser(DELAYED_CYCLE).parseEvents()) {
        snapshots.push({ ...event });
      }

      // Assert
      expect(snapshots).toHaveLength(retained.length);
      const differing = new Set<string>();
      retained.forEach((event, index) => {
        const before = event as unknown as Record<string, unknown>;
        const after = snapshots[index];
        for (const key of new Set([
          ...Object.keys(before),
          ...Object.keys(after),
        ])) {
          if (before[key] !== after[key]) {
            differing.add(`${String(before._eventName)}.${key}`);
          }
        }
      });
      expect([...differing].sort()).toEqual([
        'Drill.cycle_clearance_z_precise',
        'Drill.cycle_lower_z_precise',
        'Drill.cycle_upper_z_precise',
      ]);
    });
  });

  describe('line walking', () => {
    // The parser no longer splits the input; these pin the boundary cases
    // `split('\n')` used to handle for free.
    it.each([
      ['trailing newline', '(0)@start_of_file\nk : 1\n'],
      ['no trailing newline', '(0)@start_of_file\nk : 1'],
      ['blank lines between', '(0)@start_of_file\n\n\nk : 1\n\n'],
      ['carriage returns', '(0)@start_of_file\r\nk : 1\r\n'],
      ['leading blank line', '\n(0)@start_of_file\nk : 1\n'],
    ])('handles %s', (_label, input) => {
      const result = new Parser(input).parse();

      expect(result).toHaveLength(1);
      expect(result[0].k).toBe(1);
    });

    it('reports the same line count the old split produced', () => {
      // Arrange
      const input = 'a\nb\nc\n';

      // Act
      const { statistics } = new Parser(input).parseWithOptions();

      // Assert — 'a', 'b', 'c', and the empty string after the final newline.
      expect(statistics.totalLines).toBe(input.split('\n').length);
    });
  });

  describe('key-value backtracking', () => {
    /**
     * Guards the `\b` anchors in `keyValuePattern`. Removing them restores
     * O(n²) behaviour in line length, which the HTTP server turns into a
     * denial of service: one upload of long colon-free lines stalls a worker
     * that parses one trace at a time. The budget is deliberately loose —
     * before the anchor a single 64 KB line took ~6.6 s, so anything in the
     * same order of magnitude as the limit means the anchor is gone, not that
     * the machine is briefly busy.
     */
    it('parses a long colon-free line in linear time', () => {
      // Arrange — one 64 KB run of word characters, the worst case for the
      // pattern: nothing to match, everything to backtrack over.
      const input = `\n(0)@start_of_file\n${'a'.repeat(64 * 1024)}\nreal_key : 7\n`;

      // Act
      const started = performance.now();
      const result = new Parser(input).parse();
      const elapsed = performance.now() - started;

      // Assert — the line yields no pairs, and the one after it still parses.
      expect(elapsed).toBeLessThan(1000);
      expect(result).toHaveLength(1);
      expect(result[0].real_key).toBe(7);
    });

    it('still finds a pair whose key ends a long word run', () => {
      // Arrange — the anchor must not skip a key just because it is long.
      const key = `k${'x'.repeat(4096)}`;
      const input = `\n(0)@start_of_file\n${key} : 5\n`;

      // Act
      const result = new Parser(input).parse();

      // Assert
      expect(result[0][key]).toBe(5);
    });

    it('finds pairs that follow a long colon-free run on the same line', () => {
      // Arrange — a word start after the junk still has to be reachable.
      const input = `\n(0)@start_of_file\n${'a'.repeat(8192)} after:1 last:'two'\n`;

      // Act
      const result = new Parser(input).parse();

      // Assert
      expect(result[0].after).toBe(1);
      expect(result[0].last).toBe('two');
    });
  });
});

describe('unmodelled event reporting', () => {
  /**
   * Captures what the parser writes to stderr.
   *
   * The parser builds its own logger internally, so there is nothing to inject;
   * the output stream is the seam. Logging is off under NODE_ENV=test, so the
   * capture turns it on for the duration and restores both afterwards.
   */
  function captureParserLogs(trace: string): string[] {
    const lines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalOptions = { ...Logger.globalOptions };

    Logger.setGlobalOptions({ enabled: true, level: LogLevel.WARN });
    process.stderr.write = ((chunk: string) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      new Parser(trace).parse();
    } finally {
      process.stderr.write = originalWrite;
      Logger.setGlobalOptions(originalOptions);
    }

    return lines.filter((line) => line.includes('Unknown event type'));
  }

  it('says nothing about a modelled event that needs no special validation', () => {
    // StartOfJob has no case in the validation switch, which used to be
    // reported as "unknown" — roughly 98% of a real trace's events.
    const warnings = captureParserLogs(
      "(1)@start_of_job ==> job_name:'a'\n(1)@end_of_job ==> \n",
    );

    expect(warnings).toEqual([]);
  });

  it('reports an unmodelled top-level event once, not once per occurrence', () => {
    const warnings = captureParserLogs(
      '(1)@not_a_real_event ==> x:1\n'.repeat(50),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('NotARealEvent');
  });

  it('says nothing about an unmodelled GPP-internal callback', () => {
    // Depth above 1 is a `@usr_*` callback the post ignores by design. Every
    // fixture carries 36-37 distinct ones and zero unmodelled top-level
    // events, so warning on these fires on every healthy trace.
    const warnings = captureParserLogs('(2)@usr_coolant_output ==> x:1\n');

    expect(warnings).toEqual([]);
  });
});

describe('EVENT_NAMES', () => {
  it('mirrors every key of EventsType', () => {
    // The type annotation is the real guarantee — dropping a name fails the
    // build. This pins the runtime shape so the value cannot drift into
    // something truthy-but-wrong.
    const names = Object.keys(EVENT_NAMES);

    expect(names.length).toBeGreaterThan(30);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.values(EVENT_NAMES).every((value) => value === true)).toBe(
      true,
    );
  });

  it('recognises a parsed event name and rejects an invented one', () => {
    expect(isKnownEventName('StartOfJob')).toBe(true);
    expect(isKnownEventName('UsrCoolantOutput')).toBe(false);
  });
});

describe('emitted G-code lines', () => {
  // A trace interleaves the legacy post's own output with event parameters.
  // Only `==>` and `..>` lines carry parameters; a bare `>` is emitted G-code.
  const trace = [
    "(1)@start_of_job    ==> job_name:'D-drill4' safety:1.000",
    '                    ..> job_clearance_plane:160.000',
    '                      > N30 ; Date \t\t: JUL-12-2026-6:08:16PM',
    '                      > N202250 MSG("D-drill4 , Tool : BN1.5Z2D6L50")',
    '   beforecodes        > N10 ; COMPENSATION-WEAR',
  ].join('\n');

  it('keeps parameters from the declaration and its continuation lines', () => {
    const [event] = new Parser(trace).parse();

    expect(event.job_name).toBe('D-drill4');
    expect(event.safety).toBe(1);
    expect(event.job_clearance_plane).toBe(160);
  });

  it('takes no key-value pairs from emitted output', () => {
    const [event] = new Parser(trace).parse();

    // '6:08:16PM' in a date comment used to parse as key '6', raising a
    // ParseError on every trace; 'Tool : BN1.5Z2D6L50' in an MSG comment used
    // to attach a phantom `Tool` property to the open StartOfJob.
    expect(event['6']).toBeUndefined();
    expect(event.Tool).toBeUndefined();
    expect(Object.keys(event).filter((key) => /^\d+$/.test(key))).toEqual([]);
  });

  it('still reads cycle arguments out of emitted output', () => {
    // The retroactive `cycle_*_precise` write is a deliberate read of the
    // emitted G-code, and has to survive the key-value exclusion.
    const [drill] = new Parser(
      [
        '(1)@drill           ==> drill_depth:1.400',
        '                      > N202440 CYCLE81(160,140,1,139.6,,0,0,1,12)',
      ].join('\n'),
    ).parse();

    expect(drill.cycle_clearance_z_precise).toBe(160);
    expect(drill.cycle_upper_z_precise).toBe(140);
    expect(drill.cycle_lower_z_precise).toBe(139.6);
  });
});
