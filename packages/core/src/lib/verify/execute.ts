import { type GcodeLine, word } from './gcode';

/**
 * An abstract interpreter for an emitted program.
 *
 * It walks the main file, follows every `EXTCALL` into its subprogram at the
 * point of call, and carries modal state the way a control would — including
 * stopping a subprogram at its first `RET`, which is exactly the semantics
 * that turns an appended job body into a part cut eight times at one angle.
 *
 * This is the verifier's second derivation. It knows nothing about jobs,
 * traces or posts; it only knows what the characters mean to a machine.
 */

export type SpindleDirection = 'cw' | 'ccw' | 'off';

export interface MachineSnapshot {
  /** The tool `M6` last committed, not the one `T=` last selected. */
  tool: string | null;
  pendingTool: string | null;
  spindleSpeed: number | null;
  spindle: SpindleDirection;
  coolant: boolean;
  workOffset: number | null;
  feed: number | null;
  motionMode: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
  a: number | null;
  /** The most recent `MSG(...)` text, which legacy uses to announce a job. */
  message: string | null;
}

export interface ExecutedLine {
  /** `null` for the main program, otherwise the called file's name. */
  file: string | null;
  line: GcodeLine;
  /** Which `EXTCALL` this line is executing under; `null` in the main file. */
  callIndex: number | null;
  /** Machine state after this line. */
  state: MachineSnapshot;
  /** True when this line removes material: a feed move or a drilling cycle. */
  cutting: boolean;
  /** True for a positioning move at rapid. */
  rapid: boolean;
  /** True when the line carries a `SUPA` park. */
  supa: boolean;
}

export interface CallRecord {
  callIndex: number;
  /** The file named by the `EXTCALL`, verbatim. */
  target: string;
  /** Where the call sits in the main program. */
  mainLine: number;
  resolved: boolean;
  /** A angle modal at the moment of the call. */
  angleAtCall: number | null;
  /** Lines actually executed, i.e. up to and including the first `RET`. */
  executedLines: number;
}

export interface Execution {
  lines: ExecutedLine[];
  calls: CallRecord[];
  /** Files named by an `EXTCALL` that could not be resolved. */
  missingFiles: string[];
}

export interface ProgramFiles {
  main: GcodeLine[];
  /** Subprograms by name; lookup is case-insensitive. */
  subprograms: Map<string, GcodeLine[]>;
}

/**
 * Cycles that cut.
 *
 * `CYCLE832` (tolerance) and `CYCLE800` (swivel) are settings, not motion, so
 * they are deliberately absent — treating them as cutting would report a
 * spindle-off finding on every path-mode line legacy emits before `M3`.
 */
const CUTTING_CYCLES = new Set([
  'CYCLE81',
  'CYCLE82',
  'CYCLE83',
  'CYCLE84',
  'CYCLE85',
  'CYCLE86',
  'CYCLE87',
  'CYCLE88',
  'CYCLE89',
  'CYCLE830',
  'CYCLE840',
]);

const AXIS_LETTERS = ['X', 'Y', 'Z', 'A'] as const;

function initialState(): MachineSnapshot {
  return {
    tool: null,
    pendingTool: null,
    spindleSpeed: null,
    spindle: 'off',
    coolant: false,
    workOffset: null,
    feed: null,
    motionMode: null,
    x: null,
    y: null,
    z: null,
    a: null,
    message: null,
  };
}

function isWorkOffset(code: number): boolean {
  // G54–G59 and the extended G505–G599 range Siemens uses for further homes.
  return (code >= 54 && code <= 59) || (code >= 505 && code <= 599);
}

export function execute(files: ProgramFiles): Execution {
  const state = initialState();
  const lines: ExecutedLine[] = [];
  const calls: CallRecord[] = [];
  const missingFiles: string[] = [];
  let callIndex = 0;

  const lookup = new Map<string, GcodeLine[]>();
  for (const [name, body] of files.subprograms) {
    lookup.set(name.toLowerCase(), body);
  }

  const apply = (
    line: GcodeLine,
    file: string | null,
    inCall: number | null,
  ) => {
    if (line.toolSelect !== undefined) state.pendingTool = line.toolSelect;
    if (line.message !== undefined) state.message = line.message;

    for (const gWord of line.words) {
      if (gWord.letter === 'G') {
        const code = gWord.value;
        if (code >= 0 && code <= 3) state.motionMode = code;
        else if (isWorkOffset(code)) state.workOffset = code;
      } else if (gWord.letter === 'M') {
        const code = gWord.value;
        if (code === 6) {
          // A change commits whatever `T=` selected, which on these posts is
          // usually the same line.
          if (state.pendingTool !== null) state.tool = state.pendingTool;
        } else if (code === 3) state.spindle = 'cw';
        else if (code === 4) state.spindle = 'ccw';
        else if (code === 5) state.spindle = 'off';
        else if (code === 7 || code === 8) state.coolant = true;
        else if (code === 9) state.coolant = false;
      } else if (gWord.letter === 'S') {
        state.spindleSpeed = gWord.value;
      } else if (gWord.letter === 'F') {
        state.feed = gWord.value;
      }
    }

    const moved = AXIS_LETTERS.some(
      (letter) => word(line, letter) !== undefined,
    );
    const x = word(line, 'X');
    const y = word(line, 'Y');
    const z = word(line, 'Z');
    const a = word(line, 'A');
    if (x !== undefined) state.x = x;
    if (y !== undefined) state.y = y;
    if (z !== undefined) state.z = z;
    if (a !== undefined) state.a = a;

    const cyclesCut =
      line.cycle !== undefined && CUTTING_CYCLES.has(line.cycle.name);
    const feedMove =
      moved && state.motionMode !== null && state.motionMode >= 1;
    const rapid = moved && state.motionMode === 0;

    lines.push({
      file,
      line,
      callIndex: inCall,
      state: { ...state },
      cutting: cyclesCut || feedMove,
      rapid,
      supa: line.keywords.includes('SUPA'),
    });
  };

  const runSubprogram = (target: string, mainLine: number) => {
    const index = callIndex;
    callIndex += 1;

    const body = lookup.get(target.toLowerCase());
    if (!body) {
      if (!missingFiles.includes(target)) missingFiles.push(target);
      calls.push({
        callIndex: index,
        target,
        mainLine,
        resolved: false,
        angleAtCall: state.a,
        executedLines: 0,
      });
      return;
    }

    const angleAtCall = state.a;
    let executed = 0;
    for (const line of body) {
      apply(line, target, index);
      executed += 1;
      // A control returns at the first RET. Everything after it in the file
      // is dead, however plausible it looks.
      if (line.isRet) break;
    }

    calls.push({
      callIndex: index,
      target,
      mainLine,
      resolved: true,
      angleAtCall,
      executedLines: executed,
    });
  };

  for (const line of files.main) {
    apply(line, null, null);
    if (line.call !== undefined) runSubprogram(line.call, line.line);
  }

  return { lines, calls, missingFiles };
}
