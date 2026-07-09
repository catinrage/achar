import { describe, expect, it } from 'vitest';
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
    expect(result[0]._eventName).toBe('MalformedTest');
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
});
