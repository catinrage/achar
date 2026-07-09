import { describe, expect, it } from 'vitest';
import type { EventData } from './parser';
import { parseVmid, validateTraceAgainstVmid } from './vmid';

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
});
