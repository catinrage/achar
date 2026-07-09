import { existsSync } from 'node:fs';
import path from 'node:path';
import { BrowserView, BrowserWindow, Utils } from 'electrobun/bun';
import { listBuiltinPosts, resolveBuiltinPost } from '../../lib/builtin-posts';
import { discoverFixtures } from '../../lib/fixture';
import {
  loadMachineProfile,
  validateMachineProfileCompatibility,
} from '../../lib/machine-profile';
import {
  compareAgainstReference,
  generatePostFiles,
  parseTraceFile,
  summarizeCompareResults,
  writeGeneratedFiles,
} from '../../lib/post-test';
import { parseVmidFile, validateTraceAgainstVmid } from '../../lib/vmid';
import type {
  AcharDesktopRPC,
  DesktopBootstrap,
  DesktopDiagnostic,
  DesktopFixture,
  DesktopInput,
  GenerationResult,
  PathKind,
  ValidationResult,
} from '../rpc';

const workspaceRoot = resolveWorkspaceRoot();
const previewLimit = 180_000;

function resolveWorkspaceRoot(): string {
  const candidates = [
    Bun.env.ACHAR_WORKSPACE,
    process.cwd(),
    path.resolve(import.meta.dir, '../../..'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return (
    candidates.find((candidate) =>
      existsSync(path.join(candidate, 'package.json')),
    ) ?? process.cwd()
  );
}

async function bootstrap(): Promise<DesktopBootstrap> {
  const fixturesRoot = path.join(workspaceRoot, 'fixtures');
  let fixtures: DesktopFixture[] = [];

  if (existsSync(fixturesRoot)) {
    fixtures = (await discoverFixtures(fixturesRoot)).map((fixture) => ({
      name: fixture.name,
      root: fixture.root,
      tracePath: fixture.trace,
      referencePath: fixture.reference,
      outputPath: fixture.out,
      programName: fixture.programName,
      postId: fixture.post ?? 'siemens-828d',
      vmidPath: fixture.vmid,
      machineProfilePath: fixture.machineProfile,
    }));
  }

  return {
    workspaceRoot,
    fixturesRoot: existsSync(fixturesRoot) ? fixturesRoot : undefined,
    fixtures,
    posts: listBuiltinPosts().map((post) => ({ id: post.id, name: post.name })),
  };
}

function firstDialogPath(paths: string[]): string | null {
  const selected = paths.find((item) => item.trim().length > 0);
  return selected ? path.resolve(selected) : null;
}

async function choosePath(
  kind: PathKind,
  startingFolder?: string,
): Promise<string | null> {
  const chooseDirectory = kind === 'output' || kind === 'reference';
  const paths = await Utils.openFileDialog({
    startingFolder:
      startingFolder && existsSync(startingFolder)
        ? startingFolder
        : workspaceRoot,
    allowedFileTypes: '*',
    canChooseFiles: !chooseDirectory,
    canChooseDirectory: chooseDirectory,
    allowsMultipleSelection: false,
  });
  return firstDialogPath(paths);
}

async function loadInput(input: DesktopInput) {
  if (!input.tracePath.trim()) throw new Error('Trace 5 file is required.');
  if (!input.programName.trim()) throw new Error('Program name is required.');

  const tracePath = path.resolve(input.tracePath);
  if (!existsSync(tracePath))
    throw new Error(`Trace file not found: ${tracePath}`);

  const events = await parseTraceFile(tracePath);
  const vmid = input.vmidPath?.trim()
    ? await parseVmidFile(path.resolve(input.vmidPath))
    : undefined;
  const machineProfile = input.machineProfilePath?.trim()
    ? await loadMachineProfile(path.resolve(input.machineProfilePath))
    : undefined;
  const diagnostics = [
    ...(vmid ? validateTraceAgainstVmid(events, vmid) : []),
    ...validateMachineProfileCompatibility(machineProfile, events, vmid),
  ] satisfies DesktopDiagnostic[];

  return { events, vmid, machineProfile, diagnostics };
}

function assertNoErrors(diagnostics: DesktopDiagnostic[]): void {
  const errors = diagnostics.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join('\n'));
  }
}

async function validateInput(input: DesktopInput): Promise<ValidationResult> {
  const startedAt = performance.now();
  const loaded = await loadInput(input);
  return {
    eventCount: loaded.events.length,
    durationMs: performance.now() - startedAt,
    diagnostics: loaded.diagnostics,
  };
}

function preview(file: string, code: string): GenerationResult['preview'] {
  return {
    file,
    code: code.slice(0, previewLimit),
    truncated: code.length > previewLimit,
  };
}

async function generate(input: DesktopInput): Promise<GenerationResult> {
  const startedAt = performance.now();
  const loaded = await loadInput(input);
  assertNoErrors(loaded.diagnostics);

  const post = resolveBuiltinPost(input.postId);
  if (!post) throw new Error(`Unknown built-in post: ${input.postId}`);

  const files = generatePostFiles(
    loaded.events,
    input.programName.trim(),
    (program) =>
      post.registerPost(program, { machineProfile: loaded.machineProfile }),
  );
  const outputPath = path.resolve(
    input.outputPath?.trim() ||
      path.join(workspaceRoot, 'generated', input.programName.trim()),
  );
  await writeGeneratedFiles(files, outputPath);

  const referencePath = input.referencePath?.trim()
    ? path.resolve(input.referencePath)
    : undefined;
  const parity =
    referencePath && existsSync(referencePath)
      ? summarizeCompareResults(
          await compareAgainstReference(files, referencePath, {
            allReferenceFiles: true,
          }),
        )
      : undefined;
  const initial = files.find((file) => file.file.endsWith('.MPF')) ?? files[0];
  if (!initial) throw new Error('The selected post generated no files.');

  return {
    eventCount: loaded.events.length,
    durationMs: performance.now() - startedAt,
    diagnostics: loaded.diagnostics,
    outputPath,
    files: files.map((file) => ({
      file: file.file,
      bytes: new TextEncoder().encode(file.code).byteLength,
      lines: file.code.split(/\r?\n/).length,
    })),
    matched: parity?.match,
    different: parity?.different,
    missingGenerated: parity?.missingGenerated,
    missingReference: parity?.missingReference,
    preview: preview(initial.file, initial.code),
  };
}

async function readOutputFile(
  outputPath: string,
  file: string,
): Promise<GenerationResult['preview']> {
  const root = path.resolve(outputPath);
  const target = path.resolve(root, file);
  if (path.dirname(target) !== root)
    throw new Error('Invalid output file path.');
  if (!existsSync(target)) throw new Error(`Generated file not found: ${file}`);
  return preview(file, await Bun.file(target).text());
}

const rpc = BrowserView.defineRPC<AcharDesktopRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {
      bootstrap: () => bootstrap(),
      choosePath: ({ kind, startingFolder }) =>
        choosePath(kind, startingFolder),
      validate: (input) => validateInput(input),
      generate,
      readOutputFile: ({ outputPath, file }) =>
        readOutputFile(outputPath, file),
      openPath: ({ path: target }) => Utils.openPath(target),
    },
    messages: {},
  },
});

new BrowserWindow({
  title: 'Achar',
  url: 'views://mainview/index.html',
  rpc,
  frame: {
    width: 1280,
    height: 760,
    x: 80,
    y: 40,
  },
});
