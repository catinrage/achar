import { describe, expect, it } from 'bun:test';
import type { EventData } from './parser';
import { extractToolCatalog } from './tool-catalog';

function makeEvents(list: Record<string, unknown>[]): EventData[] {
  return list as unknown as EventData[];
}

describe('extractToolCatalog', () => {
  it('maps def_tool fields to camelCase', () => {
    const [tool] = extractToolCatalog(
      makeEvents([
        {
          _eventName: 'DefTool',
          tool_id_string: 'END12Z3AL',
          tool_name: 'EM12',
          tool_description: 'Alu rougher',
          tool_type: 'end mill',
          tool_user_type: 'ALU',
          tool_message: 'Check runout',
          holder_name: 'BT40-ER32',
          holder_description: 'Collet chuck',
          tool_diameter: 12,
          corner_radius: 0.5,
          tool_teeth_number: 3,
          tool_number: 7,
          total_tool_length: 100,
          cutting_tool_length: 35,
          tool_work_time: '  0:17:17',
        },
      ]),
    );

    expect(tool).toEqual({
      toolIdString: 'END12Z3AL',
      name: 'EM12',
      description: 'Alu rougher',
      type: 'end mill',
      userType: 'ALU',
      message: 'Check runout',
      holderName: 'BT40-ER32',
      holderDescription: 'Collet chuck',
      diameter: 12,
      cornerRadius: 0.5,
      teethCount: 3,
      toolNumber: 7,
      totalLength: 100,
      cuttingLength: 35,
      declaredWorkTime: '0:17:17',
    });
  });

  it('deduplicates by tool_id_string keeping the first occurrence', () => {
    const tools = extractToolCatalog(
      makeEvents([
        { _eventName: 'DefTool', tool_id_string: 'END6Z4', tool_name: 'first' },
        { _eventName: 'ChangeTool', tool_id_string: 'END6Z4' },
        { _eventName: 'DefTool', tool_id_string: 'DRILL5', tool_name: 'drill' },
        {
          _eventName: 'DefTool',
          tool_id_string: 'END6Z4',
          tool_name: 'second',
        },
      ]),
    );

    expect(tools).toHaveLength(2);
    expect(tools[0].toolIdString).toBe('END6Z4');
    expect(tools[0].name).toBe('first');
    expect(tools[1].toolIdString).toBe('DRILL5');
  });

  it('tolerates missing and wrong-typed fields without throwing', () => {
    const tools = extractToolCatalog(
      makeEvents([
        { _eventName: 'DefTool', tool_id_string: 'BARE' },
        { _eventName: 'DefTool', tool_id_string: 'ODD', tool_diameter: 'wide' },
      ]),
    );

    expect(tools[0]).toEqual({ toolIdString: 'BARE' });
    expect(tools[1]).toEqual({ toolIdString: 'ODD' });
  });

  it('skips def_tool events without a tool_id_string', () => {
    expect(
      extractToolCatalog(
        makeEvents([
          { _eventName: 'DefTool', tool_name: 'nameless' },
          { _eventName: 'DefTool', tool_id_string: '' },
        ]),
      ),
    ).toEqual([]);
  });

  it('omits empty and zero tool_work_time', () => {
    const tools = extractToolCatalog(
      makeEvents([
        { _eventName: 'DefTool', tool_id_string: 'A', tool_work_time: '' },
        {
          _eventName: 'DefTool',
          tool_id_string: 'B',
          tool_work_time: '  0:00:00',
        },
        {
          _eventName: 'DefTool',
          tool_id_string: 'C',
          tool_work_time: '  0:00:01',
        },
      ]),
    );

    expect(tools[0].declaredWorkTime).toBeUndefined();
    expect(tools[1].declaredWorkTime).toBeUndefined();
    expect(tools[2].declaredWorkTime).toBe('0:00:01');
  });

  it('returns an empty catalog when there are no def_tool events', () => {
    expect(extractToolCatalog(makeEvents([{ _eventName: 'Setup' }]))).toEqual(
      [],
    );
  });
});
