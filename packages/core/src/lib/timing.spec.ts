import { describe, expect, it } from 'bun:test';
import type { EventData } from './parser';
import {
  extractTimingReport,
  formatDurationSeconds,
  parseDurationSeconds,
} from './timing';

function makeEvents(list: Record<string, unknown>[]): EventData[] {
  return list as unknown as EventData[];
}

describe('parseDurationSeconds', () => {
  it('parses SolidCAM H:MM:SS strings with leading spaces', () => {
    expect(parseDurationSeconds('  0:02:55')).toBe(175);
    expect(parseDurationSeconds('1:00:00')).toBe(3600);
    expect(parseDurationSeconds('12:34:56')).toBe(45296);
  });

  it('rejects malformed values', () => {
    expect(parseDurationSeconds(undefined)).toBeUndefined();
    expect(parseDurationSeconds(175)).toBeUndefined();
    expect(parseDurationSeconds('2:75:00')).toBeUndefined();
    expect(parseDurationSeconds('fast')).toBeUndefined();
  });
});

describe('formatDurationSeconds', () => {
  it('formats to H:MM:SS', () => {
    expect(formatDurationSeconds(175)).toBe('0:02:55');
    expect(formatDurationSeconds(3600)).toBe('1:00:00');
    expect(formatDurationSeconds(45296)).toBe('12:34:56');
  });
});

describe('extractTimingReport', () => {
  it('aggregates jobs per setup and per tool, counting repeats', () => {
    const report = extractTimingReport(
      makeEvents([
        { _eventName: 'Setup', setup_name: 'Setup1' },
        {
          _eventName: 'DefTool',
          tool_id_string: 'END6Z4',
          tool_work_time: '  0:17:17',
        },
        { _eventName: 'ChangeTool', tool_id_string: 'END6Z4' },
        {
          _eventName: 'StartOfJob',
          job_name: 'iRough-faces',
          job_time: '  0:02:00',
          job_cutting_time: '  0:01:30',
          job_linking_time: '  0:00:10',
        },
        {
          _eventName: 'StartOfJob',
          job_name: 'iRough-faces',
          job_time: '  0:02:00',
          job_cutting_time: '  0:01:30',
          job_linking_time: '  0:00:10',
        },
        { _eventName: 'ChangeTool', tool_id_string: 'DRILL5' },
        {
          _eventName: 'StartOfJob',
          job_name: 'D-drill',
          job_time: '  0:00:30',
          job_cutting_time: '  0:00:20',
          job_linking_time: '  0:00:05',
        },
        { _eventName: 'Setup', setup_name: 'Setup2' },
        {
          _eventName: 'StartOfJob',
          job_name: 'F-contour',
          job_time: '  0:01:00',
          job_cutting_time: '  0:00:50',
          job_linking_time: '  0:00:05',
        },
      ]),
    );

    expect(report.duration).toBe('0:05:30');
    expect(report.seconds).toBe(330);

    expect(report.setups).toHaveLength(2);
    const [setup1, setup2] = report.setups;
    expect(setup1.name).toBe('Setup1');
    expect(setup1.duration).toBe('0:04:30');
    expect(setup1.jobs).toHaveLength(2);
    const rough = setup1.jobs[0];
    expect(rough.name).toBe('iRough-faces');
    expect(rough.tool).toBe('END6Z4');
    expect(rough.instances).toBe(2);
    expect(rough.seconds).toBe(240);
    expect(rough.cuttingSeconds).toBe(180);
    expect(rough.linkingSeconds).toBe(20);

    expect(setup2.name).toBe('Setup2');
    // F-contour runs with the tool still loaded from setup 1.
    expect(setup2.jobs[0].tool).toBe('DRILL5');

    expect(report.tools).toHaveLength(2);
    expect(report.tools[0]).toEqual({
      tool: 'END6Z4',
      seconds: 240,
      duration: '0:04:00',
      jobInstances: 2,
      declaredWorkTime: '0:17:17',
    });
    expect(report.tools[1].tool).toBe('DRILL5');
    expect(report.tools[1].seconds).toBe(90);
    expect(report.tools[1].jobInstances).toBe(2);
  });

  it('collects jobs before any setup event under a fallback setup', () => {
    const report = extractTimingReport(
      makeEvents([
        {
          _eventName: 'StartOfJob',
          job_name: 'Orphan',
          job_time: '0:00:10',
        },
      ]),
    );

    expect(report.setups).toHaveLength(1);
    expect(report.setups[0].name).toBe('(no setup)');
    expect(report.setups[0].seconds).toBe(10);
  });
});
