import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  MachineProfile,
  MachineProfilePostBinding,
} from './machine-profile';
import { validateMachineProfileCompatibility } from './machine-profile';
import type { EventData } from './parser';
import { Parser } from './parser';
import { Program } from './program';
import type { VmidDefinition, VmidValidationIssue } from './vmid';
import { formatVmidValidation, validateTraceAgainstVmid } from './vmid';

export interface GeneratedFile {
  file: string;
  code: string;
}

export interface CompareOptions {
  allReferenceFiles?: boolean;
  maxDiffsPerFile?: number;
  normalizeTimestamps?: boolean;
  strict?: boolean;
  /**
   * Strip `N<number>` block-number prefixes before comparing, so a single
   * added or removed block early in a program does not report every
   * subsequent line as different.
   */
  ignoreLineNumbers?: boolean;
}

export interface LineDifference {
  line: number;
  expected: string;
  actual: string;
}

export interface CompareResult {
  file: string;
  status: 'match' | 'different' | 'missing-reference' | 'missing-generated';
  expectedLines?: number;
  actualLines?: number;
  firstDifference?: number;
  expected?: string;
  actual?: string;
  differences?: LineDifference[];
  /**
   * True when the file only differs in `N<number>` prefixes — the G-code
   * content is identical and the numbering drifted because a block was
   * added or removed earlier in the program.
   */
  numberingDriftOnly?: boolean;
}

export interface CompareSummary {
  match: number;
  different: number;
  missingGenerated: number;
  missingReference: number;
}

export interface PostTestResult {
  files: GeneratedFile[];
  results: CompareResult[];
  summary: CompareSummary;
  vmidIssues: VmidValidationIssue[];
  /**
   * Where the post's file open/truncate pattern disagrees with the one the
   * trace recorded. Empty when the trace carries no file directives.
   */
  fileLifecycleIssues: FileLifecycleIssue[];
}

export interface PostTestConfig {
  trace: string;
  reference: string;
  out?: string;
  programName?: string;
  registerPost: (program: Program) => void;
  compare?: CompareOptions;
  update?: boolean;
  vmid?: VmidDefinition;
  machineProfile?: MachineProfile;
  /** Post metadata, when the caller knows which built-in post it is using. */
  post?: MachineProfilePostBinding;
}

export function deriveProgramName(tracePath: string): string {
  const baseName = path.basename(tracePath, path.extname(tracePath));
  return baseName.endsWith('-TR') ? baseName.slice(0, -3) : baseName;
}

export async function parseTraceFile(tracePath: string): Promise<EventData[]> {
  const source = await readFile(tracePath, 'utf-8');
  return new Parser(source).parse();
}

/**
 * Reads a trace and hands back its events as a single-use stream.
 *
 * For callers that summarise rather than post: the event array is four times
 * the size of the input string, and a summary keeps none of it. Generation must
 * keep using {@link parseTraceFile} — the post needs random access — and so must
 * anything that reads a drill's `cycle_*_precise` fields. See `Parser.parseEvents`.
 */
export async function streamTraceFile(
  tracePath: string,
): Promise<Iterable<EventData>> {
  const source = await readFile(tracePath, 'utf-8');
  return new Parser(source).parseEvents();
}

export function generatePostFiles(
  events: EventData[],
  programName: string,
  registerPost: (program: Program) => void,
): GeneratedFile[] {
  return generatePostProgram(events, programName, registerPost).generate();
}

export function generatePostProgram(
  events: EventData[],
  programName: string,
  registerPost: (program: Program) => void,
): Program {
  const program = new Program({
    programName,
    numbering: {
      enabled: true,
      start: 10,
      increment: 10,
    },
  });

  registerPost(program);
  program.loadEvents(events);
  program.process();
  return program;
}

export async function writeGeneratedFiles(
  files: GeneratedFile[],
  outputDir: string,
): Promise<void> {
  const targets = files.map((file) => ({
    ...file,
    target: resolveGeneratedFilePath(outputDir, file.file),
  }));
  await mkdir(outputDir, { recursive: true });
  await Promise.all(targets.map((file) => writeFile(file.target, file.code)));
}

export function resolveGeneratedFilePath(
  outputDir: string,
  file: string,
): string {
  if (
    file.length === 0 ||
    file === '.' ||
    file === '..' ||
    file.includes('/') ||
    file.includes('\\') ||
    file.includes('\0')
  ) {
    throw new Error(`Generated file name must be a plain file name: ${file}`);
  }

  const root = path.resolve(outputDir);
  const target = path.resolve(root, file);
  if (path.dirname(target) !== root) {
    throw new Error(`Generated file must stay inside ${root}: ${file}`);
  }
  return target;
}

export async function testPost(
  config: PostTestConfig,
): Promise<PostTestResult> {
  const traceSource = await readFile(config.trace, 'utf-8');
  const events = new Parser(traceSource).parse();
  const program = generatePostProgram(
    events,
    config.programName ?? deriveProgramName(config.trace),
    config.registerPost,
  );
  const files = program.generate();
  const fileLifecycleIssues = compareFileLifecycle(
    readTraceFileLifecycle(traceSource),
    program.fileOperations,
  );
  const vmidIssues = config.vmid
    ? validateTraceAgainstVmid(events, config.vmid)
    : [];
  vmidIssues.push(
    ...validateMachineProfileCompatibility(config.machineProfile, events, {
      vmid: config.vmid,
      post: config.post,
    }),
  );

  if (config.out) {
    await writeGeneratedFiles(files, config.out);
  }

  if (config.update) {
    await writeGeneratedFiles(files, config.reference);
  }

  const results = await compareAgainstReference(
    files,
    config.reference,
    config.compare,
  );

  return {
    files,
    results,
    summary: summarizeCompareResults(results),
    vmidIssues,
    fileLifecycleIssues,
  };
}

/**
 * Reads a reference directory and compares it against generated output.
 *
 * Thin wrapper over {@link compareGeneratedFiles}: it supplies the only piece
 * that needs a filesystem — turning the directory into NC file contents.
 */
export async function compareAgainstReference(
  generatedFiles: GeneratedFile[],
  referenceDir: string,
  options: CompareOptions = {},
): Promise<CompareResult[]> {
  const referenceNames = (await readdir(referenceDir)).filter((file) =>
    /\.(MPF|SPF)$/i.test(file),
  );
  const reference = await Promise.all(
    referenceNames.map(async (file) => ({
      file,
      code: await readFile(path.join(referenceDir, file), 'utf-8'),
    })),
  );

  return compareGeneratedFiles(generatedFiles, reference, options);
}

/**
 * Compares generated NC output against reference content already in memory.
 *
 * Pure counterpart to {@link compareAgainstReference} for callers that never
 * have the reference on disk — an HTTP request body, a fixture built in a
 * test. Names are matched case-insensitively with `-` and `_` treated as the
 * same character, since controllers and CAM disagree on NC name punctuation.
 */
export function compareGeneratedFiles(
  generatedFiles: GeneratedFile[],
  referenceFiles: GeneratedFile[],
  options: CompareOptions = {},
): CompareResult[] {
  const generatedByName = new Map(
    generatedFiles.map((file) => [file.file, file.code]),
  );
  const generatedByNormalizedName = new Map(
    generatedFiles.map((file) => [normalizeNcName(file.file), file]),
  );
  const referenceByName = new Map(
    referenceFiles.map((file) => [file.file, file.code]),
  );
  const referenceNames = [...referenceByName.keys()];
  const relevantReferenceNames = options.allReferenceFiles
    ? referenceNames
    : referenceNames.filter((file) =>
        generatedByNormalizedName.has(normalizeNcName(file)),
      );
  const relevantReferenceNormalizedNames = new Set(
    relevantReferenceNames.map(normalizeNcName),
  );
  const unmatchedGeneratedNames = generatedFiles
    .map((file) => file.file)
    .filter(
      (file) => !relevantReferenceNormalizedNames.has(normalizeNcName(file)),
    );
  const allNames = new Set([
    ...relevantReferenceNames,
    ...unmatchedGeneratedNames,
  ]);
  const results: CompareResult[] = [];

  for (const file of [...allNames].sort()) {
    const generatedFile = generatedByName.has(file)
      ? { file, code: generatedByName.get(file) ?? '' }
      : generatedByNormalizedName.get(normalizeNcName(file));

    if (!generatedFile) {
      results.push({ file, status: 'missing-generated' });
      continue;
    }

    const expected = referenceByName.get(file);
    if (expected === undefined) {
      results.push({ file, status: 'missing-reference' });
      continue;
    }

    const difference = firstDifference(expected, generatedFile.code, options);
    if (difference.firstDifference === undefined) {
      results.push({
        file: displayComparedFile(file, generatedFile.file),
        status: 'match',
      });
      continue;
    }

    const numberingDriftOnly =
      options.ignoreLineNumbers !== true &&
      firstDifference(expected, generatedFile.code, {
        ...options,
        ignoreLineNumbers: true,
      }).firstDifference === undefined;

    results.push({
      file: displayComparedFile(file, generatedFile.file),
      status: 'different',
      numberingDriftOnly,
      ...difference,
    });
  }

  return results;
}

export function summarizeCompareResults(
  results: CompareResult[],
): CompareSummary {
  return {
    match: results.filter((result) => result.status === 'match').length,
    different: results.filter((result) => result.status === 'different').length,
    missingGenerated: results.filter(
      (result) => result.status === 'missing-generated',
    ).length,
    missingReference: results.filter(
      (result) => result.status === 'missing-reference',
    ).length,
  };
}

export function formatCompareResults(results: CompareResult[]): string {
  const counts = summarizeCompareResults(results);
  const lines = [
    `Parity: ${counts.match} matched, ${counts.different} different, ${counts.missingGenerated} missing generated, ${counts.missingReference} missing reference`,
  ];
  const table = formatCompareTable(results);
  if (table.length > 0) {
    lines.push('', table);
  }

  for (const result of results) {
    if (result.status === 'match') continue;

    lines.push('', `${result.file}: ${result.status}`);
    const differences =
      result.differences ??
      (result.firstDifference === undefined
        ? []
        : [
            {
              line: result.firstDifference,
              expected: result.expected ?? '',
              actual: result.actual ?? '',
            },
          ]);

    for (const difference of differences) {
      lines.push(
        `  line ${difference.line}`,
        `    expected: ${difference.expected}`,
        `    actual:   ${difference.actual}`,
      );
    }
  }

  return lines.join('\n');
}

export function formatCompareTable(results: CompareResult[]): string {
  const rows = results.filter((result) => result.status !== 'match');
  if (rows.length === 0) return '';

  const statusLabel = (row: CompareResult): string =>
    row.numberingDriftOnly === true ? `${row.status} (numbering)` : row.status;
  const fileWidth = Math.max(
    'file'.length,
    ...rows.map((row) => row.file.length),
  );
  const statusWidth = Math.max(
    'status'.length,
    ...rows.map((row) => statusLabel(row).length),
  );
  const lines = [
    `${'file'.padEnd(fileWidth)}  ${'status'.padEnd(statusWidth)}  first diff`,
    `${'-'.repeat(fileWidth)}  ${'-'.repeat(statusWidth)}  ----------`,
  ];

  for (const row of rows) {
    lines.push(
      `${row.file.padEnd(fileWidth)}  ${statusLabel(row).padEnd(statusWidth)}  ${
        row.firstDifference ?? ''
      }`,
    );
  }

  return lines.join('\n');
}

export async function writeHtmlReport(
  results: CompareResult[],
  reportPath: string,
): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderHtmlReport(results));
}

export function assertPostMatchesReference(result: PostTestResult): void {
  const hasDifferences = result.results.some(
    (compareResult) => compareResult.status !== 'match',
  );
  const vmidErrors = result.vmidIssues.filter(
    (issue) => issue.severity === 'error',
  );

  const lifecycleIssues = result.fileLifecycleIssues ?? [];

  if (hasDifferences || vmidErrors.length > 0 || lifecycleIssues.length > 0) {
    throw new Error(
      [
        vmidErrors.length > 0 ? formatVmidValidation(vmidErrors) : '',
        // Ahead of the line diff on purpose: when it fires it names the
        // cause, and the diff below it is the downstream noise.
        formatFileLifecycleIssues(lifecycleIssues),
        hasDifferences ? formatCompareResults(result.results) : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }
}

function firstDifference(
  expected: string,
  actual: string,
  options: CompareOptions,
): Pick<
  CompareResult,
  | 'expectedLines'
  | 'actualLines'
  | 'firstDifference'
  | 'expected'
  | 'actual'
  | 'differences'
> {
  const normalizeLine = (line: string): string => {
    const base =
      options.strict === true
        ? line
        : normalizeVolatileLine(line, options).trimEnd();
    return options.ignoreLineNumbers === true
      ? base.replace(/^N\d+ ?/, '')
      : base;
  };
  const expectedLines = expected.split(/\r?\n/);
  const actualLines = actual.split(/\r?\n/);
  const maxLines = Math.max(expectedLines.length, actualLines.length);
  const differences: LineDifference[] = [];
  const maxDiffs = options.maxDiffsPerFile ?? 5;

  for (let index = 0; index < maxLines; index++) {
    const expectedLine = expectedLines[index] ?? '<missing>';
    const actualLine = actualLines[index] ?? '<missing>';
    if (normalizeLine(expectedLine) !== normalizeLine(actualLine)) {
      differences.push({
        line: index + 1,
        expected: expectedLine,
        actual: actualLine,
      });
      if (differences.length >= maxDiffs) break;
    }
  }

  if (differences.length > 0) {
    return {
      expectedLines: expectedLines.length,
      actualLines: actualLines.length,
      firstDifference: differences[0].line,
      expected: differences[0].expected,
      actual: differences[0].actual,
      differences,
    };
  }

  return {
    expectedLines: expectedLines.length,
    actualLines: actualLines.length,
  };
}

function renderHtmlReport(results: CompareResult[]): string {
  const counts = summarizeCompareResults(results);
  const rows = results
    .map((result) => {
      const diffs = (result.differences ?? [])
        .map(
          (difference) =>
            `<li><strong>line ${difference.line}</strong><pre>expected: ${escapeHtml(difference.expected)}\nactual:   ${escapeHtml(difference.actual)}</pre></li>`,
        )
        .join('');
      return `<section class="file ${result.status}">
        <h2>${escapeHtml(result.file)} <span>${result.status}</span></h2>
        ${diffs ? `<ul>${diffs}</ul>` : ''}
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Achar Post Test Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #1f2937; }
    .summary { display: flex; gap: 16px; margin-bottom: 24px; }
    .summary div { border: 1px solid #d1d5db; padding: 8px 12px; border-radius: 6px; }
    section { border-top: 1px solid #e5e7eb; padding: 12px 0; }
    h2 { font-size: 16px; margin: 0 0 8px; }
    h2 span { font-size: 12px; color: #6b7280; margin-left: 8px; }
    pre { background: #f9fafb; padding: 8px; overflow-x: auto; }
    .match { color: #166534; }
    .different, .missing-generated, .missing-reference { color: #991b1b; }
  </style>
</head>
<body>
  <h1>Achar Post Test Report</h1>
  <div class="summary">
    <div>${counts.match} matched</div>
    <div>${counts.different} different</div>
    <div>${counts.missingGenerated} missing generated</div>
    <div>${counts.missingReference} missing reference</div>
  </div>
  ${rows}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function normalizeVolatileLine(line: string, options: CompareOptions): string {
  if (options.normalizeTimestamps === false) {
    return line;
  }

  return line.replace(
    /^(N\d+\s*;\s*Date\s*:\s*).+$/i,
    '$1<normalized-post-date>',
  );
}

function normalizeNcName(file: string): string {
  return file.replaceAll('-', '_').toLowerCase();
}

function displayComparedFile(
  referenceFile: string,
  generatedFile: string,
): string {
  return referenceFile === generatedFile
    ? referenceFile
    : `${referenceFile} <- ${generatedFile}`;
}

/**
 * The subprogram file lifecycle a trace records, per file.
 *
 * SolidCAM's trace carries the legacy post's own file directives —
 * `!! delete file = X !!`, `!! open file = X !!` — and a delete immediately
 * before an open means that open starts from empty. That is ground truth for
 * something a line diff explains badly: a post that appends where legacy
 * truncates produces a file holding one body per repeat, and since EXTCALL
 * returns at the first RET, every call runs the first body. The program looks
 * plausible and cuts every rotary position at the same angle.
 *
 * Unlike the `>` output lines in a trace, these are not G-code — reading them
 * tells us what the legacy post *did with files*, not what it emitted, so a
 * fixture can check structure without the post being handed its own answer.
 */
export interface TraceFileLifecycle {
  file: string;
  /** One entry per open, in order: did that open start from empty? */
  opens: ('append' | 'replace')[];
}

const FILE_DIRECTIVE =
  /^\s*(?:>\s*)?!!\s*(delete|open|close)\s*file\s*=\s*(\S+?)\s*!!\s*$/;

/**
 * Reads the file directives a trace recorded, grouped by file.
 *
 * Returns an empty array for a trace that carries no directives — a post that
 * writes one file, or a trace taken with file tracing off. Absence is not a
 * finding, so callers should skip the check rather than report a mismatch.
 */
export function readTraceFileLifecycle(
  traceSource: string,
): TraceFileLifecycle[] {
  const byFile = new Map<string, ('append' | 'replace')[]>();
  let pendingDelete: string | undefined;

  for (const line of traceSource.split('\n')) {
    const match = FILE_DIRECTIVE.exec(line);
    if (!match) continue;
    const [, verb, file] = match as unknown as [string, string, string];

    if (verb === 'delete') {
      pendingDelete = file;
      continue;
    }
    if (verb === 'open') {
      const opens = byFile.get(file) ?? [];
      opens.push(pendingDelete === file ? 'replace' : 'append');
      byFile.set(file, opens);
    }
    pendingDelete = undefined;
  }

  return [...byFile].map(([file, opens]) => ({ file, opens }));
}

export interface FileLifecycleIssue {
  file: string;
  traceOpens: number;
  postOpens: number;
  /** Did a re-open of this file start from empty? */
  traceTruncates: boolean;
  postTruncates: boolean;
}

/**
 * Compares a post's file operations against the lifecycle a trace recorded.
 *
 * Only one question is asked, per file: when this file was opened again, did
 * the content so far survive? Open *counts* are deliberately not compared —
 * a post may split an append-only file across more opens than the legacy one
 * did and produce identical bytes, so counting would raise noise on output
 * that is already proven correct by the reference. Truncation is different:
 * it decides whether the file ends up holding one body or N, and nothing in
 * a line diff says so plainly.
 */
export function compareFileLifecycle(
  traceLifecycle: TraceFileLifecycle[],
  operations: readonly { file: string; mode: 'append' | 'replace' }[],
): FileLifecycleIssue[] {
  if (traceLifecycle.length === 0) return [];

  const actualByFile = new Map<string, ('append' | 'replace')[]>();
  for (const operation of operations) {
    const modes = actualByFile.get(operation.file) ?? [];
    modes.push(operation.mode);
    actualByFile.set(operation.file, modes);
  }

  // The first open of a name truncates nothing, so it carries no signal.
  const truncatesOnRepeat = (modes: ('append' | 'replace')[]): boolean =>
    modes.slice(1).includes('replace');

  const issues: FileLifecycleIssue[] = [];
  for (const { file, opens } of traceLifecycle) {
    const actual = actualByFile.get(file) ?? [];
    const traceTruncates = truncatesOnRepeat(opens);
    const postTruncates = truncatesOnRepeat(actual);
    if (traceTruncates === postTruncates) continue;
    issues.push({
      file,
      traceOpens: opens.length,
      postOpens: actual.length,
      traceTruncates,
      postTruncates,
    });
  }
  return issues;
}

function traceTruncatingIssue(issues: FileLifecycleIssue[]): boolean {
  return issues.some((issue) => issue.traceTruncates && !issue.postTruncates);
}

export function formatFileLifecycleIssues(
  issues: FileLifecycleIssue[],
): string {
  if (issues.length === 0) return '';
  return [
    'File lifecycle differs from the trace (open/delete directives):',
    ...issues.map(
      ({ file, traceOpens, postOpens, traceTruncates }) =>
        `  ${file}: trace opens ${traceOpens}x and ${traceTruncates ? 'truncates' : 'appends'} on re-open; ` +
        `post opens ${postOpens}x and ${traceTruncates ? 'appends' : 'truncates'}`,
    ),
    traceTruncatingIssue(issues)
      ? '  A file holding one body per repeat runs only its first body: EXTCALL returns at the first RET.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
