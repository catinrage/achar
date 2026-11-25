import { describe, expect, it } from 'bun:test';
import type { EventData } from './parser';
import {
  isThreeAxisVmid,
  parseVmid,
  validateTraceAgainstVmid,
  vmidHasRotaryAxis,
} from './vmid';

const vmidSource = `
<Machine Name="Demo_4X">
  <Axis Name="X" MinLim="-10" MaxLim="10" HomeRef="0">
  <Axis Name="Y" MinLim="-10" MaxLim="10" HomeRef="0">
  <Axis Name="Z" MinLim="-10" MaxLim="10" HomeRef="0">
  <Axis Name="A" MinLim="-360" MaxLim="360" HomeRef="0">
  <Param GppName="bToolPreselect" Name="Tool preselect">
  <ParamJobs GppName="C81_DTB" Name="Drill dwell">
</Machine>
`;

describe('VMID parsing and validation', () => {
  it('parses axes and user parameters from a VMID file', () => {
    const vmid = parseVmid(vmidSource);

    expect(vmid.machine.Name).toBe('Demo_4X');
    expect(vmid.axes.map((axis) => axis.name)).toEqual(['X', 'Y', 'Z', 'A']);
    expect(vmid.parameters.map((param) => param.gppName)).toEqual([
      'bToolPreselect',
      'C81_DTB',
    ]);
  });

  it('reports undeclared user parameters and missing axes', () => {
    const vmid = parseVmid(vmidSource);
    const events: EventData[] = [
      {
        _eventName: 'StartOfFile',
        _index: 0,
        VMID_file: 'Demo_4X',
        bToolPreselect: 1,
        bMissingParam: 1,
      },
      {
        _eventName: 'Line5x',
        _index: 1,
        x: 1,
        c: 90,
      },
    ];

    const issues = validateTraceAgainstVmid(events, vmid);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          key: 'bMissingParam',
        }),
        expect.objectContaining({
          severity: 'error',
          key: 'c',
        }),
      ]),
    );
  });

  it('distinguishes 3-axis and 4-axis VMIDs and checks rotary fields on 3-axis VMIDs', () => {
    const fourAxis = parseVmid(vmidSource);
    const threeAxis = parseVmid(`
<Machine Name="Mill_3A">
  <Axis Name="X" Type="0" MinLim="-500" MaxLim="500" HomeRef="0">
  <Axis Name="Y" Type="0" MinLim="-300" MaxLim="300" HomeRef="0">
  <Axis Name="Z" Type="0" MinLim="0" MaxLim="500" HomeRef="0">
  <Param GppName="iNumberOfAixs" Name="Number of Axis">
</Machine>
`);

    expect(vmidHasRotaryAxis(fourAxis)).toBe(true);
    expect(isThreeAxisVmid(fourAxis)).toBe(false);
    expect(vmidHasRotaryAxis(threeAxis)).toBe(false);
    expect(isThreeAxisVmid(threeAxis)).toBe(true);

    // Zero rotary placeholders and PlaneData/Tmatrix plane angles are fine.
    expect(
      validateTraceAgainstVmid(
        [
          {
            _eventName: 'StartOfFile',
            _index: 0,
            VMID_file: 'Mill_4A',
            iNumberOfAixs: 4,
          },
          { _eventName: 'Setup', _index: 1, setup_name: 'Setup1' },
          {
            _eventName: 'StartOfJob',
            _index: 2,
            job_name: 'Profile1',
            anext: 0,
          },
          { _eventName: 'Drill', _index: 3, cpos: 0 },
          { _eventName: 'PlaneData', _index: 4, first_axis_angle: 180 },
          { _eventName: 'Tmatrix', _index: 5, rotate_angle_x: -90 },
        ],
        threeAxis,
        { allowTraceVmidMismatch: true },
      ),
    ).toEqual([]);

    // Real rotary commands (apos, non-zero anext, FourthAxis, 4x transform) fail.
    const rotaryIssues = validateTraceAgainstVmid(
      [
        {
          _eventName: 'StartOfFile',
          _index: 0,
          VMID_file: 'Mill_4A',
          iNumberOfAixs: 4,
        },
        { _eventName: 'Setup', _index: 1, setup_name: 'RotarySetup' },
        { _eventName: 'RotateToPlane', _index: 2, anext: -15 },
      ],
      threeAxis,
      { allowTraceVmidMismatch: true },
    );

    expect(rotaryIssues).toEqual([
      expect.objectContaining({
        severity: 'error',
        event: 'RotateToPlane',
        key: 'anext',
      }),
    ]);
    expect(rotaryIssues[0]?.message).toContain('Setup 1 (RotarySetup)');
  });
});
