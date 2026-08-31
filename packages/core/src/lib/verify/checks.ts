import type { ExecutedLine, Execution } from './execute';
import type { GcodeLine } from './gcode';
import type { JobIntent, ProgramIntent } from './intent';

/**
 * The checks.
 *
 * Each one states something that must be true of a program that will cut the
 * part the trace describes, and each is written to fire on nothing when the
 * program is healthy. That bar is not decoration: a check that cries wolf on
 * legacy output is a check nobody runs, and an unrun check is worse than none
 * because it looks like coverage.
 */

export type Severity = 'scrap' | 'wrong' | 'suspect' | 'info';

export interface Finding {
  check: string;
  /**
   * How many times this exact finding occurred.
   *
   * A rotary pattern called eight times reports the same defect eight times.
   * That is one bug, and printing it once with a count is the difference
   * between a report someone reads and a wall someone scrolls past.
   */
  occurrences?: number;
  severity: Severity;
  message: string;
  file: string | null;
  line?: number;
  jobIndex?: number;
  jobName?: string;
  detail?: string;
}

export interface CheckContext {
  intent: ProgramIntent;
  execution: Execution;
  subprograms: Map<string, GcodeLine[]>;
  /** Lines executed under each call, in order. */
  byCall: Map<number, ExecutedLine[]>;
  jobFor(callIndex: number): JobIntent | undefined;
  /** False when calls and jobs did not line up, so per-job checks are unsafe. */
  aligned: boolean;
}

export interface Check {
  id: string;
  severity: Severity;
  describe: string;
  run(context: CheckContext): Finding[];
}

const TOLERANCE = 1e-4;

function close(a: number, b: number, tolerance = TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

function firstCutting(lines: ExecutedLine[]): ExecutedLine | undefined {
  return lines.find((entry) => entry.cutting);
}

function at(entry: ExecutedLine): { file: string | null; line: number } {
  return { file: entry.file, line: entry.line.line };
}

/**
 * `MSG("F-contour4 , Tool : END8Z3N")`.
 *
 * Legacy writes the job name and the tool id it *intends* to cut with. That
 * makes the message a second, independent statement of intent living inside
 * the output itself — which is why the mismatch check below needs no trace.
 */
const MESSAGE_TOOL = /,\s*Tool\s*:\s*(.+?)\s*$/;

/**
 * Cycles that drive the spindle themselves.
 *
 * `@drill` emits a flat `S100 M3` ahead of a tapping cycle and passes the real
 * speed inside the call — `CYCLE84(…,300,450,…)`. The modal S is a placeholder
 * there, so reading it as the cutting speed reports a finding on every tap in
 * a healthy program.
 */
const SPINDLE_OWNING_CYCLES = new Set(['CYCLE84', 'CYCLE840']);

// ---------------------------------------------------------------------------

const callCount: Check = {
  id: 'call-count',
  severity: 'wrong',
  describe: 'Every job in the trace is called exactly once, in order.',
  run({ intent, execution }) {
    const calls = execution.calls.length;
    const jobs = intent.jobs.length;
    if (calls === jobs) return [];
    return [
      {
        check: 'call-count',
        severity: 'wrong',
        message: `The trace has ${jobs} job instance(s) but the program makes ${calls} subprogram call(s).`,
        file: null,
        detail:
          'Per-job checks are skipped when these disagree, because a call cannot be attributed to a job.',
      },
    ];
  },
};

const missingSubprogram: Check = {
  id: 'missing-subprogram',
  severity: 'scrap',
  describe: 'Every called subprogram exists.',
  run({ execution }) {
    return execution.calls
      .filter((call) => !call.resolved)
      .map((call) => ({
        check: 'missing-subprogram',
        severity: 'scrap' as const,
        message: `EXTCALL "${call.target}" has no such file.`,
        file: null,
        line: call.mainLine,
      }));
  },
};

const deadCodeAfterRet: Check = {
  id: 'dead-code-after-ret',
  severity: 'scrap',
  describe: 'A subprogram returns once, and nothing follows the return.',
  run({ subprograms }) {
    const findings: Finding[] = [];
    for (const [name, body] of subprograms) {
      const returnAt = body.findIndex((line) => line.isRet);
      if (returnAt === -1) {
        findings.push({
          check: 'dead-code-after-ret',
          severity: 'scrap',
          message: `${name} never returns: no RET.`,
          file: name,
        });
        continue;
      }
      const dead = body
        .slice(returnAt + 1)
        .find(
          (line) =>
            line.words.length > 0 ||
            line.cycle !== undefined ||
            line.call !== undefined ||
            line.isRet,
        );
      if (dead) {
        findings.push({
          check: 'dead-code-after-ret',
          severity: 'scrap',
          message: `${name} has executable code after its first RET; a control never reaches it.`,
          file: name,
          line: dead.line,
          detail: `First RET at line ${body[returnAt].line}, unreachable code at line ${dead.line}: ${dead.raw.trim()}`,
        });
      }
    }
    return findings;
  },
};

const messageToolMismatch: Check = {
  id: 'message-tool-mismatch',
  severity: 'scrap',
  describe: 'The tool a subprogram announces is the tool it cuts with.',
  run({ byCall, execution }) {
    const findings: Finding[] = [];
    for (const call of execution.calls) {
      const lines = byCall.get(call.callIndex) ?? [];
      const cutting = firstCutting(lines);
      if (!cutting) continue;

      const announced = MESSAGE_TOOL.exec(cutting.state.message ?? '')?.[1];
      if (!announced) continue;

      if (cutting.state.tool !== announced) {
        findings.push({
          check: 'message-tool-mismatch',
          severity: 'scrap',
          message: `${call.target} announces tool "${announced}" but cuts with ${cutting.state.tool === null ? 'no tool loaded' : `"${cutting.state.tool}"`}.`,
          ...at(cutting),
          detail:
            'The program names the right tool in its MSG and never loads it — the pattern runs on whatever is in the spindle.',
        });
      }
    }
    return findings;
  },
};

const toolInSpindle: Check = {
  id: 'tool-in-spindle',
  severity: 'scrap',
  describe: 'Each job cuts with the tool the trace assigns it.',
  run({ byCall, execution, jobFor, aligned }) {
    if (!aligned) return [];
    const findings: Finding[] = [];
    for (const call of execution.calls) {
      const job = jobFor(call.callIndex);
      if (!job?.toolId) continue;
      const cutting = firstCutting(byCall.get(call.callIndex) ?? []);
      if (!cutting) continue;

      if (cutting.state.tool !== job.toolId) {
        findings.push({
          check: 'tool-in-spindle',
          severity: 'scrap',
          message: `${job.jobName} must cut with "${job.toolId}" but the spindle holds ${cutting.state.tool === null ? 'no tool' : `"${cutting.state.tool}"`}.`,
          ...at(cutting),
          jobIndex: job.index,
          jobName: job.jobName,
        });
      }
    }
    return findings;
  },
};

const spindleStopped: Check = {
  id: 'spindle-stopped',
  severity: 'scrap',
  describe: 'The spindle is turning before anything cuts.',
  run({ execution }) {
    const findings: Finding[] = [];
    for (const entry of execution.lines) {
      if (!entry.cutting) continue;
      if (entry.state.spindle === 'off') {
        findings.push({
          check: 'spindle-stopped',
          severity: 'scrap',
          message: 'Cutting move with the spindle stopped.',
          ...at(entry),
          detail: entry.line.raw.trim(),
        });
      } else if (
        entry.state.spindleSpeed === null ||
        entry.state.spindleSpeed === 0
      ) {
        findings.push({
          check: 'spindle-stopped',
          severity: 'scrap',
          message: 'Cutting move with no spindle speed set.',
          ...at(entry),
          detail: entry.line.raw.trim(),
        });
      }
    }
    return findings;
  },
};

const feedMissing: Check = {
  id: 'feed-missing',
  severity: 'scrap',
  describe: 'Every feed move has a feed rate.',
  run({ execution }) {
    return execution.lines
      .filter(
        (entry) =>
          entry.cutting &&
          entry.line.cycle === undefined &&
          (entry.state.feed === null || entry.state.feed === 0),
      )
      .map((entry) => ({
        check: 'feed-missing',
        severity: 'scrap' as const,
        message: 'Feed move with no active feed rate.',
        ...at(entry),
        detail: entry.line.raw.trim(),
      }));
  },
};

const rotaryAngleCoverage: Check = {
  id: 'rotary-angle-coverage',
  severity: 'scrap',
  describe:
    'A rotary pattern is called at every angle the trace positions it at.',
  run({ execution, jobFor, aligned }) {
    if (!aligned) return [];

    const byFile = new Map<
      string,
      { emitted: Set<number>; expected: Set<number>; line: number }
    >();

    for (const call of execution.calls) {
      const job = jobFor(call.callIndex);
      if (!job?.transform4x) continue;
      const bucket = byFile.get(call.target) ?? {
        emitted: new Set<number>(),
        expected: new Set<number>(),
        line: call.mainLine,
      };
      if (call.angleAtCall !== null) bucket.emitted.add(call.angleAtCall);
      if (job.startPosition.a !== undefined) {
        bucket.expected.add(Number(job.startPosition.a.toFixed(4)));
      }
      byFile.set(call.target, bucket);
    }

    const findings: Finding[] = [];
    for (const [file, bucket] of byFile) {
      if (bucket.expected.size === 0) continue;
      const missing = [...bucket.expected].filter(
        (angle) => ![...bucket.emitted].some((value) => close(value, angle)),
      );
      if (missing.length > 0) {
        findings.push({
          check: 'rotary-angle-coverage',
          severity: 'scrap',
          message: `${file} is a rotary pattern the trace positions at ${bucket.expected.size} angle(s), but the program only reaches ${bucket.emitted.size}.`,
          file: null,
          line: bucket.line,
          detail: `Never reached: A${missing.join(', A')}`,
        });
      }
    }
    return findings;
  },
};

const cycleDepth: Check = {
  id: 'cycle-depth',
  severity: 'scrap',
  describe: 'Drill cycles use the depths the trace specifies.',
  run({ byCall, execution, jobFor, aligned }) {
    if (!aligned) return [];
    const findings: Finding[] = [];

    for (const call of execution.calls) {
      const job = jobFor(call.callIndex);
      if (!job || job.drills.length === 0) continue;

      // One emitted cycle per drill point, in the order the trace lists them.
      const expected = job.drills.flatMap((drill) =>
        Array.from({ length: Math.max(drill.pointCount, 0) }, () => drill),
      );
      const emitted = (byCall.get(call.callIndex) ?? []).filter(
        (entry) => entry.cutting && entry.line.cycle !== undefined,
      );
      if (expected.length === 0 || emitted.length !== expected.length) continue;

      emitted.forEach((entry, index) => {
        const drill = expected[index];
        const args = entry.line.cycle?.args ?? [];
        // CYCLE81/83/84 share the leading shape (RTP, RFP, SDIS, DP).
        const planes: Array<[string, number, number]> = [
          ['retracts to', Number(args[1]), drill.upperZ],
          ['bottoms at', Number(args[3]), drill.lowerZ],
        ];
        for (const [what, emitted, expected] of planes) {
          if (!Number.isFinite(emitted) || close(emitted, expected, 1e-3)) {
            continue;
          }
          findings.push({
            check: 'cycle-depth',
            severity: 'scrap',
            message: `${drill.cycleName} ${what} Z${emitted} where the trace says Z${expected}.`,
            ...at(entry),
            jobIndex: job.index,
            jobName: job.jobName,
          });
        }
      });
    }
    return findings;
  },
};

const spindleSpeed: Check = {
  id: 'spindle-speed',
  severity: 'wrong',
  describe: 'A job only cuts at a speed the trace asked for.',
  run({ byCall, execution, jobFor, aligned }) {
    if (!aligned) return [];
    const findings: Finding[] = [];
    for (const call of execution.calls) {
      const job = jobFor(call.callIndex);
      if (!job || job.commandedSpeeds.length === 0) continue;

      const seen = new Set<number>();
      for (const entry of byCall.get(call.callIndex) ?? []) {
        const speed = entry.state.spindleSpeed;
        if (!entry.cutting || speed === null || seen.has(speed)) continue;
        if (
          entry.line.cycle !== undefined &&
          SPINDLE_OWNING_CYCLES.has(entry.line.cycle.name)
        ) {
          continue;
        }
        seen.add(speed);
        if (job.commandedSpeeds.some((value) => close(value, speed, 0.5))) {
          continue;
        }
        findings.push({
          check: 'spindle-speed',
          severity: 'wrong',
          message: `${job.jobName} cuts at S${speed}, a speed the trace never commands for it.`,
          ...at(entry),
          jobIndex: job.index,
          jobName: job.jobName,
          detail: `Commanded: S${[...new Set(job.commandedSpeeds)].join(', S')}`,
        });
      }
    }
    return findings;
  },
};

const coolantOff: Check = {
  id: 'coolant-off',
  severity: 'suspect',
  describe: 'A job that asks for flood coolant has it on before it cuts.',
  run({ byCall, execution, jobFor, aligned }) {
    if (!aligned) return [];
    const findings: Finding[] = [];
    for (const call of execution.calls) {
      const job = jobFor(call.callIndex);
      if (!job?.floodCoolant) continue;
      const cutting = firstCutting(byCall.get(call.callIndex) ?? []);
      if (!cutting || cutting.state.coolant) continue;

      findings.push({
        check: 'coolant-off',
        severity: 'suspect',
        message: `${job.jobName} asks for flood coolant but cuts with it off.`,
        ...at(cutting),
        jobIndex: job.index,
        jobName: job.jobName,
      });
    }
    return findings;
  },
};

/*
 * Deliberately absent: a "rapid through material" check.
 *
 * It was written, run against all eight fixtures, and removed. A contour job
 * legitimately repositions at rapid below `job_upper_plane` — over ground it
 * has already cleared, or outside the stock in XY — and nothing in a trace
 * says which. Answering it needs stock geometry the verifier does not have.
 *
 * Shipping it anyway would have added two hundred findings to healthy legacy
 * output, and a check that cries wolf is worse than no check: it teaches
 * people to skim past the ones that matter.
 */

export const CHECKS: Check[] = [
  callCount,
  missingSubprogram,
  deadCodeAfterRet,
  messageToolMismatch,
  toolInSpindle,
  spindleStopped,
  feedMissing,
  rotaryAngleCoverage,
  cycleDepth,
  spindleSpeed,
  coolantOff,
];
