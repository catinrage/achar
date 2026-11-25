import { describe, expect, it } from 'bun:test';
import { DirectionEnum } from '../../common/enums';
import type { EventData } from '../../lib/parser';
import { Program } from '../../lib/program';
import { registerSiemens828dPost } from './post';

function makeEvents(items: Array<Record<string, unknown>>): EventData[] {
  return items.map((item, index) => ({
    ...item,
    _index: index,
  })) as EventData[];
}

function preamble() {
  return [
    {
      _eventName: 'StartOfFile',
      part_name: 'Part',
      user_account: 'op',
      part_model_name: 'Part.SLDASM',
      part_full_name: 'Part.prz',
      inch_system: false,
      iNumberOfAixs: 4,
    },
    { _eventName: 'StartProgram' },
  ];
}

function changeTool(toolNumber: number, toolId: string, nextToolId = '') {
  return {
    _eventName: 'ChangeTool',
    tool_number: toolNumber,
    tool_id_string: toolId,
    next_tool_id_string: nextToolId,
    last_tool: nextToolId === '',
  };
}

function jobEvents(options: {
  name: string;
  toolNumber: number;
  nextToolNumber: number;
  translate?: boolean;
  rotary4x?: boolean;
  anext?: number;
  iWBCM?: number;
  sWCM_MSG?: string;
}) {
  return [
    {
      _eventName: 'StartOfJob',
      job_name: options.name,
      original_job_name: options.name.replace(/-/g, '_'),
      job_type: 'contour',
      tool_number: options.toolNumber,
      next_job_tool_number: options.nextToolNumber,
      spin_rate: 5000,
      spin_direction: DirectionEnum.CW,
      job_clearance_plane: 50,
      job_upper_plane: 10,
      job_lower_plane: 0,
      xnext: 0,
      ynext: 0,
      znext: 50,
      anext: options.anext ?? 0,
      used_in_transform_4x: options.rotary4x ? 1 : 0,
      used_in_transform_mirror: 0,
      used_in_transform_translate: options.translate ? 1 : 0,
      used_in_transform_coordsys: 0,
      used_in_transform_rotate: 0,
      compensation: false,
      mill_pivot_length: 0,
      max_spin: 12000,
      msg: '',
      HSM_job: 0,
      X5_job: 0,
      thread_index_job: '',
      feed_unit: 'mm_min',
      feed_status: 'feed',
      spin_unit: 'rpm',
      iWBCM: options.iWBCM ?? 0,
      sWCM_MSG: options.sWCM_MSG ?? '',
      nTC_XSUPA: -465,
      nTC_YSUPA: 140,
    },
    { _eventName: 'EndOfJob' },
  ];
}

function refPoint(init: boolean, xhome = 0, yhome = 0) {
  return {
    _eventName: 'ChangeRefPoint',
    xhome,
    yhome,
    zhome: 0,
    absolute: false,
    ref_point_init: init,
  };
}

function postMain(events: Array<Record<string, unknown>>): string[] {
  const program = new Program({ programName: 'Main' });
  registerSiemens828dPost(program, { measureTools: false });
  program.loadEvents(makeEvents(events));
  program.process();
  const main = program.generate().find((file) => file.file === 'Main.MPF');
  if (!main) throw new Error('Main.MPF was not generated');
  return main.code.split('\n').map((line) => line.replace(/^N\d+\s*/, ''));
}

function lineIndex(lines: string[], needle: string, from = 0): number {
  const idx = lines.findIndex(
    (line, position) => position >= from && line.includes(needle),
  );
  if (idx === -1) {
    throw new Error(
      `Expected line containing '${needle}' in:\n${lines.join('\n')}`,
    );
  }
  return idx;
}

describe('siemens 828d tool health checks', () => {
  it.each([
    1, 2, 3,
  ])('runs iWBCM=%i check only after the last translated occurrence and after trailing TRANS reset', (mode) => {
    const lines = postMain([
      ...preamble(),
      changeTool(138, 'BN6Z2U', 'BN8Z2'),
      ...jobEvents({
        name: 'HSS-PC-Lin-faces1',
        toolNumber: 138,
        nextToolNumber: 137,
        translate: true,
        iWBCM: mode,
        sWCM_MSG: 'Check tool!',
      }),
      refPoint(false, 35, 0),
      ...jobEvents({
        name: 'HSS-PC-Lin-faces1',
        toolNumber: 138,
        nextToolNumber: 137,
        translate: true,
        iWBCM: mode,
        sWCM_MSG: 'Check tool!',
      }),
      refPoint(true, -35, 0),
      changeTool(137, 'BN8Z2'),
      ...jobEvents({
        name: 'NextOp',
        toolNumber: 137,
        nextToolNumber: 138,
      }),
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const extcalls = lines
      .map((line, index) =>
        line === 'EXTCALL "HSS_PC_Lin_faces1.SPF"' ? index : -1,
      )
      .filter((index) => index !== -1);
    expect(extcalls).toHaveLength(2);

    // No check between the 1st and 2nd translated occurrence.
    const between = lines.slice(extcalls[0], extcalls[1]);
    expect(between.some((line) => line.includes('M1'))).toBe(false);
    expect(between.some((line) => line.includes('GOTOB LTC'))).toBe(false);

    // Trailing TRANS reset precedes the check so GOTOB LTC cannot jump back shifted.
    const transReset = lineIndex(lines, 'TRANS', extcalls[1]);
    expect(lines[transReset]).toBe('TRANS');

    const msgIdx = lineIndex(lines, 'MSG("Check tool!")', extcalls[1]);
    const m1Idx = lineIndex(lines, 'M1', extcalls[1]);
    const gotobIdx = lineIndex(lines, 'GOTOB LTC', extcalls[1]);
    const nextOpIdx = lineIndex(lines, 'EXTCALL "NextOp.SPF"');

    expect(extcalls[1]).toBeLessThan(transReset);
    expect(transReset).toBeLessThan(msgIdx);
    expect(msgIdx).toBeLessThan(m1Idx);
    expect(m1Idx).toBeLessThan(gotobIdx);
    expect(gotobIdx).toBeLessThan(nextOpIdx);
    expect(lines.filter((line) => line === 'LTC:')).toHaveLength(1);
  });

  it('runs the check after the final translated occurrence when TRANS resets before it', () => {
    const lines = postMain([
      ...preamble(),
      changeTool(18, 'END4Z4', 'CHAMFER6Z4'),
      refPoint(false, -35, 0),
      ...jobEvents({
        name: 'F-contour3',
        toolNumber: 18,
        nextToolNumber: 62,
        translate: true,
        iWBCM: 2,
        sWCM_MSG: 'Check END4Z4!',
      }),
      refPoint(true, 35, 0),
      ...jobEvents({
        name: 'F-contour3',
        toolNumber: 18,
        nextToolNumber: 62,
        translate: true,
        iWBCM: 2,
        sWCM_MSG: 'Check END4Z4!',
      }),
      changeTool(62, 'CHAMFER6Z4'),
      ...jobEvents({
        name: 'ChamferOp',
        toolNumber: 62,
        nextToolNumber: 18,
      }),
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const extcalls = lines
      .map((line, index) => (line === 'EXTCALL "F_contour3.SPF"' ? index : -1))
      .filter((index) => index !== -1);
    expect(extcalls).toHaveLength(2);

    const checkMsg = lineIndex(lines, 'MSG("Check END4Z4!")');
    const chamferIdx = lineIndex(lines, 'EXTCALL "ChamferOp.SPF"');
    expect(checkMsg).toBeGreaterThan(extcalls[1]);
    expect(checkMsg).toBeLessThan(chamferIdx);
    expect(lines.filter((line) => line.includes('GOTOB LTC'))).toHaveLength(1);
  });

  it('waits until the last iteration of a multi-job translate group', () => {
    const lines = postMain([
      ...preamble(),
      changeTool(137, 'BN8Z2', 'DRILL2.5C'),
      ...jobEvents({
        name: 'D-drill2-2',
        toolNumber: 137,
        nextToolNumber: 137,
        translate: true,
        iWBCM: 2,
        sWCM_MSG: 'Check BN8Z2!',
      }),
      ...jobEvents({
        name: 'D-drill3-2',
        toolNumber: 137,
        nextToolNumber: 79,
        translate: true,
      }),
      refPoint(false, 35, 0),
      ...jobEvents({
        name: 'D-drill2-2',
        toolNumber: 137,
        nextToolNumber: 137,
        translate: true,
        iWBCM: 2,
        sWCM_MSG: 'Check BN8Z2!',
      }),
      ...jobEvents({
        name: 'D-drill3-2',
        toolNumber: 137,
        nextToolNumber: 79,
        translate: true,
      }),
      refPoint(true, -35, 0),
      changeTool(79, 'DRILL2.5C'),
      ...jobEvents({
        name: 'AfterLoop',
        toolNumber: 79,
        nextToolNumber: 137,
      }),
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const firstDrill3 = lines.indexOf('EXTCALL "D_drill3_2.SPF"');
    const secondDrill3 = lines.lastIndexOf('EXTCALL "D_drill3_2.SPF"');
    expect(firstDrill3).toBeGreaterThan(-1);
    expect(firstDrill3).toBeLessThan(secondDrill3);

    const checkMsg = lineIndex(lines, 'MSG("Check BN8Z2!")');
    const transReset = lineIndex(lines, 'TRANS', secondDrill3);
    expect(checkMsg).toBeGreaterThan(transReset);
    expect(lines.filter((line) => line.includes('GOTOB LTC'))).toHaveLength(1);
  });

  it('runs the check only after the last 4x-transform instance', () => {
    const lines = postMain([
      ...preamble(),
      changeTool(260, 'BN1.5Z2D6L50', 'TM3P0.5'),
      ...jobEvents({
        name: 'D-drill5',
        toolNumber: 260,
        nextToolNumber: 250,
        rotary4x: true,
        anext: 45,
        iWBCM: 2,
        sWCM_MSG: 'Check 4x!',
      }),
      ...jobEvents({
        name: 'D-drill5',
        toolNumber: 260,
        nextToolNumber: 250,
        rotary4x: true,
        anext: 0,
        iWBCM: 2,
        sWCM_MSG: 'Check 4x!',
      }),
      changeTool(250, 'TM3P0.5'),
      ...jobEvents({
        name: 'TapOp',
        toolNumber: 250,
        nextToolNumber: 260,
      }),
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const firstCall = lines.indexOf('EXTCALL "D_drill5.SPF"');
    const secondCall = lines.lastIndexOf('EXTCALL "D_drill5.SPF"');
    expect(firstCall).toBeGreaterThan(-1);
    expect(firstCall).toBeLessThan(secondCall);
    const checkMsg = lineIndex(lines, 'MSG("Check 4x!")');
    expect(checkMsg).toBeGreaterThan(secondCall);
    expect(lines.filter((line) => line.includes('GOTOB LTC'))).toHaveLength(1);
  });

  it('defers across consecutive non-translated jobs sharing a tool', () => {
    const lines = postMain([
      ...preamble(),
      changeTool(38, 'END8Z4', 'END3Z4'),
      ...jobEvents({
        name: 'F-contour17',
        toolNumber: 38,
        nextToolNumber: 38,
        iWBCM: 2,
        sWCM_MSG: 'Check shared tool!',
      }),
      ...jobEvents({
        name: 'iRough-contour14',
        toolNumber: 38,
        nextToolNumber: 217,
      }),
      changeTool(217, 'END3Z4'),
      ...jobEvents({
        name: 'NextToolOp',
        toolNumber: 217,
        nextToolNumber: 38,
      }),
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const firstOp = lineIndex(lines, 'EXTCALL "F_contour17.SPF"');
    const secondOp = lineIndex(lines, 'EXTCALL "iRough_contour14.SPF"');
    const checkMsg = lineIndex(lines, 'MSG("Check shared tool!")');
    expect(checkMsg).toBeGreaterThan(secondOp);
    expect(lines.slice(firstOp, secondOp).some((l) => l.includes('M1'))).toBe(
      false,
    );
    expect(lines.filter((line) => line.includes('GOTOB LTC'))).toHaveLength(1);
  });

  it('still emits the check on the final translated job before EndProgram even when next_job_tool_number wraps to the same tool', () => {
    const lines = postMain([
      ...preamble(),
      changeTool(11, 'END10Z4'),
      ...jobEvents({
        name: 'Pocket',
        toolNumber: 11,
        nextToolNumber: 11,
        translate: true,
        iWBCM: 1,
        sWCM_MSG: 'Check final tool!',
      }),
      refPoint(false, 25, 0),
      ...jobEvents({
        name: 'Pocket',
        toolNumber: 11,
        nextToolNumber: 11,
        translate: true,
        iWBCM: 1,
        sWCM_MSG: 'Check final tool!',
      }),
      refPoint(true, -25, 0),
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const lastCall = lines.lastIndexOf('EXTCALL "Pocket.SPF"');
    const transReset = lineIndex(lines, 'TRANS', lastCall);
    const checkMsg = lineIndex(lines, 'MSG("Check final tool!")');
    const endIdx = lineIndex(lines, 'M2');

    expect(checkMsg).toBeGreaterThan(transReset);
    expect(checkMsg).toBeLessThan(endIdx);
    expect(lines.filter((line) => line.includes('GOTOB LTC'))).toHaveLength(1);
  });

  it('emits a setup-end health check before the next Setup heading and respects same-tool continuation', () => {
    const differentToolNextSetup = postMain([
      ...preamble(),
      { _eventName: 'Setup', setup_name: 'Setup1' },
      changeTool(11, 'END10Z4', 'END8Z4'),
      ...jobEvents({
        name: 'Op1',
        toolNumber: 11,
        nextToolNumber: 38,
        iWBCM: 2,
        sWCM_MSG: 'Check Setup1!',
      }),
      { _eventName: 'Setup', setup_name: 'Setup2' },
      changeTool(38, 'END8Z4'),
      ...jobEvents({
        name: 'Op2',
        toolNumber: 38,
        nextToolNumber: 11,
      }),
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const checkIdx = lineIndex(differentToolNextSetup, 'MSG("Check Setup1!")');
    const setup2Idx = lineIndex(differentToolNextSetup, '; Setup 2');
    expect(checkIdx).toBeLessThan(setup2Idx);

    const sameToolNextSetup = postMain([
      ...preamble(),
      { _eventName: 'Setup', setup_name: 'Setup1' },
      changeTool(11, 'END10Z4'),
      ...jobEvents({
        name: 'Op1',
        toolNumber: 11,
        nextToolNumber: 11,
        iWBCM: 2,
        sWCM_MSG: 'Should defer!',
      }),
      { _eventName: 'Setup', setup_name: 'Setup2' },
      changeTool(11, 'END10Z4'),
      ...jobEvents({
        name: 'Op2',
        toolNumber: 11,
        nextToolNumber: 11,
      }),
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    expect(
      sameToolNextSetup.some((line) => line.includes('MSG("Should defer!")')),
    ).toBe(false);
  });
});
