import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CHECKS, type Check, type Finding, type Severity } from './checks';
import { type ExecutedLine, type Execution, execute } from './execute';
import { type GcodeLine, parseGcodeFile } from './gcode';
import type { JobIntent, ProgramIntent } from './intent';

/**
 * Verification: does this program do what the trace said to do?
 *
 * Two derivations meet here. `intent.ts` read the trace; `execute.ts` read the
 * emitted code. Neither consulted the post that connects them, so agreement
 * between them is evidence rather than tautology — the same reason a ledger is
 * kept twice.
 */

export interface ProgramSource {
  /** The main program's file name, for reporting. */
  mainName: string;
  main: GcodeLine[];
  subprograms: Map<string, GcodeLine[]>;
}

export interface VerifyOptions {
  /** Run only these check ids. Defaults to all. */
  only?: readonly string[];
  /** Findings at or above this severity. Defaults to every severity. */
  minimumSeverity?: Severity;
}

export interface VerifyResult {
  findings: Finding[];
  jobCount: number;
  callCount: number;
  executedLines: number;
  aligned: boolean;
  checksRun: string[];
}

const SEVERITY_ORDER: Record<Severity, number> = {
  scrap: 3,
  wrong: 2,
  suspect: 1,
  info: 0,
};

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER[severity];
}

/** Folds identical findings into one, carrying the count. */
function collapse(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.check}\u0000${finding.file}\u0000${finding.line}\u0000${finding.message}`;
    const existing = byKey.get(key);
    if (existing) existing.occurrences = (existing.occurrences ?? 1) + 1;
    else byKey.set(key, { ...finding, occurrences: 1 });
  }
  return [...byKey.values()];
}

function groupByCall(execution: Execution): Map<number, ExecutedLine[]> {
  const byCall = new Map<number, ExecutedLine[]>();
  for (const entry of execution.lines) {
    if (entry.callIndex === null) continue;
    const bucket = byCall.get(entry.callIndex);
    if (bucket) bucket.push(entry);
    else byCall.set(entry.callIndex, [entry]);
  }
  return byCall;
}

export function verifyProgram(
  intent: ProgramIntent,
  source: ProgramSource,
  options: VerifyOptions = {},
): VerifyResult {
  const execution = execute({
    main: source.main,
    subprograms: source.subprograms,
  });

  const aligned = execution.calls.length === intent.jobs.length;
  const byCall = groupByCall(execution);

  const context = {
    intent,
    execution,
    subprograms: source.subprograms,
    byCall,
    aligned,
    jobFor: (callIndex: number): JobIntent | undefined =>
      aligned ? intent.jobs[callIndex] : undefined,
  };

  const selected: Check[] = options.only
    ? CHECKS.filter((check) => options.only?.includes(check.id))
    : CHECKS;

  const floor =
    options.minimumSeverity === undefined
      ? 0
      : SEVERITY_ORDER[options.minimumSeverity];

  const findings = collapse(
    selected
      .flatMap((check) => check.run(context))
      .filter((finding) => SEVERITY_ORDER[finding.severity] >= floor),
  ).sort(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      (a.jobIndex ?? -1) - (b.jobIndex ?? -1) ||
      (a.line ?? 0) - (b.line ?? 0),
  );

  return {
    findings,
    jobCount: intent.jobs.length,
    callCount: execution.calls.length,
    executedLines: execution.lines.length,
    aligned,
    checksRun: selected.map((check) => check.id),
  };
}

const CODE_FILE = /\.(MPF|SPF)$/i;

/**
 * Reads a directory of emitted G-code.
 *
 * The main program is the one the trace named. Falling back to "the `.MPF`
 * that makes subprogram calls" covers a directory whose main file was renamed,
 * and refusing to guess past that is deliberate: verifying the wrong file as
 * main would silently attribute every job to the wrong place.
 */
export async function loadProgramSource(
  directory: string,
  preferredMain?: string,
): Promise<ProgramSource> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && CODE_FILE.test(entry.name))
    .map((entry) => entry.name);

  if (files.length === 0) {
    throw new Error(`No .MPF or .SPF files found in ${directory}`);
  }

  const parsed = new Map<string, GcodeLine[]>();
  for (const name of files) {
    const source = await readFile(path.join(directory, name), 'utf8');
    parsed.set(name, parseGcodeFile(source));
  }

  const wanted = preferredMain?.toLowerCase();
  let mainName =
    files.find((name) => name.toLowerCase() === wanted) ??
    files.find(
      (name) =>
        /\.MPF$/i.test(name) &&
        (parsed.get(name) ?? []).some((line) => line.call !== undefined),
    );

  if (!mainName) {
    const mpfs = files.filter((name) => /\.MPF$/i.test(name));
    if (mpfs.length !== 1) {
      throw new Error(
        `Cannot tell which file is the main program in ${directory}. Pass the program name explicitly.`,
      );
    }
    mainName = mpfs[0];
  }

  // Only `.SPF` files are subprograms. Another `.MPF` in the directory is a
  // separate main program — the tool-measurement program legacy writes beside
  // the part program is one — and calling it a subprogram would report it as
  // never returning, which is true and irrelevant.
  const subprograms = new Map<string, GcodeLine[]>();
  for (const [name, body] of parsed) {
    if (name !== mainName && /\.SPF$/i.test(name)) subprograms.set(name, body);
  }

  return { mainName, main: parsed.get(mainName) ?? [], subprograms };
}
