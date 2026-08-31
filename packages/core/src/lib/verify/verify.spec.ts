import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverFixtures } from '../fixture';
import { Parser } from '../parser';
import { execute } from './execute';
import { parseGcodeFile, parseGcodeLine } from './gcode';
import { deriveIntent, type JobIntent, type ProgramIntent } from './intent';
import { type ProgramSource, verifyProgram } from './verify';

describe('gcode reader', () => {
  it('reads a tool selection and its change on one line', () => {
    const line = parseGcodeLine('N161510 T="BN1.5Z2D6L50" M6 ', 1);
    expect(line.number).toBe(161510);
    expect(line.toolSelect).toBe('BN1.5Z2D6L50');
    expect(line.words).toEqual([{ letter: 'M', value: 6 }]);
  });

  it('reads a positioning block', () => {
    const line = parseGcodeLine('N161530 G0 G54 G90 X-304.99997 Y-0.00001', 1);
    expect(line.words).toEqual([
      { letter: 'G', value: 0 },
      { letter: 'G', value: 54 },
      { letter: 'G', value: 90 },
      { letter: 'X', value: -304.99997 },
      { letter: 'Y', value: -0.00001 },
    ]);
  });

  it('keeps omitted cycle arguments positional', () => {
    const line = parseGcodeLine(
      'N161660 CYCLE81(160,140,1,139.6,,0,0,1,12)',
      1,
    );
    expect(line.cycle?.name).toBe('CYCLE81');
    expect(line.cycle?.args).toEqual([
      '160',
      '140',
      '1',
      '139.6',
      '',
      '0',
      '0',
      '1',
      '12',
    ]);
  });

  it('reads a message and a call', () => {
    expect(
      parseGcodeLine('N161480 MSG("D-drill4 , Tool : BN1.5Z2D6L50")', 1)
        .message,
    ).toBe('D-drill4 , Tool : BN1.5Z2D6L50');
    expect(parseGcodeLine('N160310 EXTCALL "D_drill4.SPF"', 1).call).toBe(
      'D_drill4.SPF',
    );
  });

  it('separates a comment from code', () => {
    const line = parseGcodeLine('N161570 G1 X5 ; D-drill4', 1);
    expect(line.comment).toBe('D-drill4');
    expect(line.words).toEqual([
      { letter: 'G', value: 1 },
      { letter: 'X', value: 5 },
    ]);
  });
});

function source(
  main: string,
  subprograms: Record<string, string>,
): ProgramSource {
  return {
    mainName: 'MAIN.MPF',
    main: parseGcodeFile(main),
    subprograms: new Map(
      Object.entries(subprograms).map(([name, body]) => [
        name,
        parseGcodeFile(body),
      ]),
    ),
  };
}

describe('execution', () => {
  it('stops a subprogram at its first RET', () => {
    const execution = execute(
      source('EXTCALL "A.SPF"', {
        'A.SPF': 'G1 X1 F100\nRET\nG1 X2 F100',
      }),
    );
    // The second move is written but never reached.
    expect(execution.calls[0].executedLines).toBe(2);
    expect(
      execution.lines.some((entry) => entry.line.raw === 'G1 X2 F100'),
    ).toBe(false);
  });

  it('commits a tool only when M6 runs', () => {
    const execution = execute(
      source('EXTCALL "A.SPF"', {
        'A.SPF': 'T="END8Z4"\nG1 X1 F100 S500 M3\nT="END4Z4" M6\nG1 X2\nRET',
      }),
    );
    const cutting = execution.lines.filter((entry) => entry.cutting);
    // Selected but not changed: the spindle still holds nothing.
    expect(cutting[0].state.tool).toBeNull();
    expect(cutting[1].state.tool).toBe('END4Z4');
  });

  it('records the angle modal at each call', () => {
    const execution = execute(
      source('A-45\nEXTCALL "A.SPF"\nA-90\nEXTCALL "A.SPF"', {
        'A.SPF': 'G1 X1 F100\nRET',
      }),
    );
    expect(execution.calls.map((call) => call.angleAtCall)).toEqual([-45, -90]);
  });
});

function job(overrides: Partial<JobIntent> = {}): JobIntent {
  return {
    index: 0,
    jobName: 'J1',
    originalJobName: 'J1',
    jobType: 'profile',
    fileName: 'A.SPF',
    toolId: 'END8Z4',
    spinRate: 5000,
    clearancePlane: 100,
    upperPlane: 50,
    lowerPlane: 0,
    safety: 2,
    startPosition: {},
    transform4x: false,
    transformTranslate: false,
    floodCoolant: false,
    isDrillJob: false,
    drills: [],
    commandedSpeeds: [5000],
    announcedToolChange: true,
    ...overrides,
  };
}

function intent(jobs: JobIntent[]): ProgramIntent {
  return { jobs, tools: new Map() };
}

describe('checks', () => {
  it('reports the tool a job announces but never loads', () => {
    const result = verifyProgram(
      intent([job()]),
      source('EXTCALL "A.SPF"', {
        'A.SPF':
          'MSG("J1 , Tool : END8Z4")\nT="DRILL2.5C" M6\nS5000 M3\nG1 X1 F100\nRET',
      }),
    );
    const findings = result.findings.map((finding) => finding.check);
    expect(findings).toContain('message-tool-mismatch');
    expect(findings).toContain('tool-in-spindle');
  });

  it('passes when the announced tool is the one loaded', () => {
    const result = verifyProgram(
      intent([job()]),
      source('EXTCALL "A.SPF"', {
        'A.SPF':
          'MSG("J1 , Tool : END8Z4")\nT="END8Z4" M6\nS5000 M3\nG1 X1 F100\nRET',
      }),
    );
    expect(result.findings).toEqual([]);
  });

  it('reports a cut taken with the spindle stopped', () => {
    const result = verifyProgram(
      intent([job()]),
      source('EXTCALL "A.SPF"', {
        'A.SPF': 'T="END8Z4" M6\nS5000\nG1 X1 F100\nRET',
      }),
    );
    expect(result.findings.map((finding) => finding.check)).toContain(
      'spindle-stopped',
    );
  });

  it('reports a rotary pattern that never reaches every angle', () => {
    const rotary = (index: number, angle: number) =>
      job({
        index,
        jobName: `R${index}`,
        transform4x: true,
        startPosition: { a: angle },
      });
    const result = verifyProgram(
      intent([rotary(0, 0), rotary(1, -45)]),
      // Both calls happen at A0: the second angle is never commanded.
      source('A0\nEXTCALL "A.SPF"\nEXTCALL "A.SPF"', {
        'A.SPF': 'T="END8Z4" M6\nS5000 M3\nG1 X1 F100\nRET',
      }),
    );
    expect(result.findings.map((finding) => finding.check)).toContain(
      'rotary-angle-coverage',
    );
  });

  it('reports executable code after a return', () => {
    const result = verifyProgram(
      intent([job()]),
      source('EXTCALL "A.SPF"', {
        'A.SPF': 'T="END8Z4" M6\nS5000 M3\nG1 X1 F100\nRET\nG1 X2 F100\nRET',
      }),
    );
    expect(result.findings.map((finding) => finding.check)).toContain(
      'dead-code-after-ret',
    );
  });

  it('collapses one defect repeated across every instance', () => {
    const result = verifyProgram(
      intent([job({ index: 0 }), job({ index: 1 })]),
      source('EXTCALL "A.SPF"\nEXTCALL "A.SPF"', {
        'A.SPF':
          'MSG("J1 , Tool : END8Z4")\nT="DRILL2.5C" M6\nS5000 M3\nG1 X1 F100\nRET',
      }),
    );
    const mismatch = result.findings.find(
      (finding) => finding.check === 'message-tool-mismatch',
    );
    expect(mismatch?.occurrences).toBe(2);
  });
});

/**
 * Legacy output is the verifier's witness set.
 *
 * Every one of these programs was posted by the GPP and cut real parts, so a
 * finding here is either a historical bug worth investigating or — far more
 * likely — a check that misunderstands the post. Keeping this at zero is what
 * makes a finding on new output mean something.
 */
const fixtureRoot = path.resolve(__dirname, '../../../../../fixtures');
const fixtures = existsSync(fixtureRoot)
  ? (await discoverFixtures(fixtureRoot)).filter((fixture) =>
      existsSync(fixture.reference),
    )
  : [];

describe.if(fixtures.length > 0)('legacy reference output', () => {
  for (const fixture of fixtures) {
    it(`verifies clean: ${path.basename(fixture.root)}`, async () => {
      const { loadProgramSource } = await import('./verify');
      const events = new Parser(await readFile(fixture.trace, 'utf8')).parse();
      const result = verifyProgram(
        deriveIntent(events),
        await loadProgramSource(
          fixture.reference,
          path.basename(fixture.trace),
        ),
      );

      expect(result.aligned).toBe(true);
      expect(
        result.findings.map(
          (finding) =>
            `${finding.check} ${finding.file}:${finding.line} ${finding.message}`,
        ),
      ).toEqual([]);
      // Parsing a 60 MB trace and walking 50k emitted lines outruns the
      // default per-test budget; pinned here so the suite does not depend on
      // the runner being invoked with a flag.
    }, 60_000);
  }
});
