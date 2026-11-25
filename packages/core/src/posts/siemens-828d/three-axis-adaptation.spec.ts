import { describe, expect, it } from 'bun:test';
import { DirectionEnum } from '../../common/enums';
import { parseMachineProfile } from '../../lib/machine-profile';
import type { EventData } from '../../lib/parser';
import { Program } from '../../lib/program';
import { parseVmid } from '../../lib/vmid';
import { registerSiemens828dPost } from './post';

function makeEvents(items: Array<Record<string, unknown>>): EventData[] {
  return items.map((item, index) => ({
    ...item,
    _index: index,
  })) as EventData[];
}

const THREE_AXIS_VMID = parseVmid(`
<Machine Name="PoyaKar_1160L_3A">
  <Axis Name="Y" Type="0" MinLim="-300" MaxLim="300" HomeRef="-300">
  <Axis Name="X" Type="0" MinLim="-550" MaxLim="550" HomeRef="-550">
  <Axis Name="Z" Type="0" MinLim="0" MaxLim="600" HomeRef="600">
</Machine>
`);

describe('siemens-828d 3-axis adaptation from 4-axis traces', () => {
  it('omits A words when posting a 4-axis-VMID setup onto a 3-axis machine', () => {
    const profile = parseMachineProfile({
      id: 'poyakar-3a',
      axes: 3,
      dialect: 'Siemens_828D_Milling_3A',
      features: { allow4xTraceOn3x: true },
    });

    const events = makeEvents([
      {
        _eventName: 'StartOfFile',
        part_name: 'Part',
        user_account: 'op',
        part_model_name: 'Part.SLDASM',
        part_full_name: 'Part.prz',
        inch_system: false,
        VMID_file: 'Siemens_828D_Milling_4A',
        iNumberOfAixs: 4,
      },
      { _eventName: 'DefTool', tool_id_string: 'EM10', tool_number: 1 },
      { _eventName: 'StartProgram' },
      { _eventName: 'Setup', setup_name: 'Setup1' },
      {
        _eventName: 'ChangeTool',
        tool_number: 1,
        tool_id_string: 'EM10',
        last_tool: true,
      },
      {
        _eventName: 'StartOfJob',
        job_name: 'F-contour',
        original_job_name: 'F_contour',
        job_type: 'profile',
        xnext: 10,
        ynext: 20,
        znext: 50,
        anext: 0,
        spin_rate: 3000,
        spin_direction: DirectionEnum.CW,
        next_job_tool_number: 1,
        used_in_transform_4x: 0,
        used_in_transform_translate: 0,
        used_in_transform_rotate: 0,
      },
      { _eventName: 'RapidMove', xpos: 10, ypos: 20, zpos: 50 },
      { _eventName: 'Line', xpos: 40, ypos: 20, zpos: -2, feed: 500 },
      { _eventName: 'EndOfJob' },
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const program = new Program({
      programName: 'Part',
      numbering: { enabled: true, start: 10, increment: 10 },
    });
    registerSiemens828dPost(program, {
      machineProfile: profile,
      vmid: THREE_AXIS_VMID,
    });
    program.loadEvents(events);
    program.process();

    const files = program.generate();
    const jobFile = files.find((file) => file.file === 'F_contour.SPF');
    const mainFile = files.find((file) => file.file === 'Part.MPF');

    expect(jobFile).toBeDefined();
    expect(jobFile?.code).toContain('G0 G54 G90 X10 Y20');
    expect(jobFile?.code).not.toMatch(/\bA-?\d/);
    expect(mainFile?.code).toContain('; Tools Used In This Program :');
    expect(mainFile?.code).not.toMatch(/\bA-?\d/);
  });

  it('infers 3-axis locking from a 3-axis VMID even when profile.axes is omitted', () => {
    const profile = parseMachineProfile({
      id: 'poyakar-implicit-axes',
      dialect: 'Siemens_828D_Milling_3A',
      features: { allow4xTraceOn3x: true },
    });

    const events = makeEvents([
      {
        _eventName: 'StartOfFile',
        part_name: 'Part',
        user_account: 'op',
        part_model_name: 'Part.SLDASM',
        part_full_name: 'Part.prz',
        inch_system: false,
        VMID_file: 'Siemens_828D_Milling_4A',
        iNumberOfAixs: 4,
      },
      { _eventName: 'DefTool', tool_id_string: 'DRILL5', tool_number: 2 },
      { _eventName: 'StartProgram' },
      {
        _eventName: 'ChangeTool',
        tool_number: 2,
        tool_id_string: 'DRILL5',
        last_tool: true,
      },
      {
        _eventName: 'StartOfJob',
        job_name: 'D-drill',
        original_job_name: 'D_drill',
        job_type: 'drill',
        xnext: 15,
        ynext: 25,
        znext: 50,
        anext: 0,
        spin_rate: 2000,
        spin_direction: DirectionEnum.CW,
        next_job_tool_number: 2,
        used_in_transform_4x: 0,
        used_in_transform_translate: 0,
        used_in_transform_rotate: 0,
      },
      {
        _eventName: 'Drill',
        drill_cycle_name: 'CYCLE81',
        xpos: 15,
        ypos: 25,
        zpos: -5,
        feed: 200,
        drill_clearance_z: 50,
        drill_upper_z: 0,
        drill_lower_z: -5,
        safety: 2,
        retract_distance: 2,
      },
      {
        _eventName: 'DrillPoint',
        xpos: 15,
        ypos: 25,
        zpos: 0,
        apos: 0,
        first_drill: true,
      },
      { _eventName: 'EndDrill' },
      { _eventName: 'EndOfJob' },
      { _eventName: 'EndProgram' },
      { _eventName: 'EndOfFile' },
    ]);

    const program = new Program({
      programName: 'Part',
      numbering: { enabled: true, start: 10, increment: 10 },
    });
    registerSiemens828dPost(program, {
      machineProfile: profile,
      vmid: THREE_AXIS_VMID,
    });
    program.loadEvents(events);
    program.process();

    const jobFile = program
      .generate()
      .find((file) => file.file === 'D_drill.SPF');
    expect(jobFile).toBeDefined();
    expect(jobFile?.code).toContain('G0 G54 G90 X15 Y25');
    expect(jobFile?.code).not.toMatch(/\bA-?\d/);
  });
});
