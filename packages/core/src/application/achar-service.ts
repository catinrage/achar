import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { listBuiltinPosts, resolveBuiltinPost } from '../lib/builtin-posts';
import { discoverFixtures } from '../lib/fixture';
import {
  loadMachineProfile,
  validateMachineProfileCompatibility,
} from '../lib/machine-profile';
import {
  compareAgainstReference,
  generatePostFiles,
  parseTraceFile,
  resolveGeneratedFilePath,
  summarizeCompareResults,
  writeGeneratedFiles,
} from '../lib/post-test';
import { parseVmidFile, validateTraceAgainstVmid } from '../lib/vmid';

const previewLimit = 180_000;

export interface AcharFixtureSummary {
  name: string;
  root: string;
  tracePath: string;
  referencePath: string;
  outputPath?: string;
  programName: string;
  postId: string;
  vmidPath?: string;
  machineProfilePath?: string;
  /** Manifest opted out of parity and other test runs. */
  ignored: boolean;
}

export interface AcharMachineProfileSummary {
  id: string;
  name?: string;
  controller?: string;
  axes?: number;
  path: string;
}

export interface AcharBootstrap {
  workspaceRoot: string;
  fixturesRoot?: string;
  fixtures: AcharFixtureSummary[];
  machineProfiles: AcharMachineProfileSummary[];
  posts: Array<{ id: string; name: string }>;
  mcp: {
    command: string;
    args: string[];
    environment: Record<string, string>;
  };
}

export interface AcharDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  event?: string;
  key?: string;
}

export interface AcharInput {
  tracePath: string;
  vmidPath?: string;
  machineProfilePath?: string;
  referencePath?: string;
  outputPath?: string;
  programName: string;
  postId: string;
}

export interface AcharValidationResult {
  eventCount: number;
  durationMs: number;
  diagnostics: AcharDiagnostic[];
}

export interface AcharGeneratedFile {
  file: string;
  bytes: number;
  lines: number;
}

export interface AcharGenerationResult extends AcharValidationResult {
  outputPath: string;
  files: AcharGeneratedFile[];
  matched?: number;
  different?: number;
  missingGenerated?: number;
  missingReference?: number;
  preview: {
    file: string;
    code: string;
    truncated: boolean;
  };
}

export function resolveWorkspaceRoot(): string {
  const candidates = [
    Bun.env.ACHAR_WORKSPACE,
    process.cwd(),
    findWorkspaceRoot(process.cwd()),
    findWorkspaceRoot(import.meta.dir),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return (
    candidates.find((candidate) => isWorkspaceRoot(candidate)) ?? process.cwd()
  );
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = path.resolve(start);

  while (true) {
    if (isWorkspaceRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isWorkspaceRoot(candidate: string): boolean {
  return (
    existsSync(path.join(candidate, 'package.json')) &&
    existsSync(path.join(candidate, 'fixtures'))
  );
}

export async function bootstrapAchar(
  workspaceRoot = resolveWorkspaceRoot(),
): Promise<AcharBootstrap> {
  const fixturesRoot = path.join(workspaceRoot, 'fixtures');
  let fixtures: AcharFixtureSummary[] = [];
  let machineProfiles: AcharMachineProfileSummary[] = [];

  if (existsSync(fixturesRoot)) {
    // The MCP workspace tool still lists ignored fixtures; only test runs
    // exclude them.
    fixtures = (
      await discoverFixtures(fixturesRoot, { includeIgnored: true })
    ).map((fixture) => ({
      name: fixture.name,
      root: fixture.root,
      tracePath: fixture.trace,
      referencePath: fixture.reference,
      outputPath: fixture.out,
      programName: fixture.programName,
      postId: fixture.post ?? 'siemens-828d',
      vmidPath: fixture.vmid,
      machineProfilePath: fixture.machineProfile,
      ignored: fixture.ignored,
    }));
    machineProfiles = await discoverMachineProfiles(fixturesRoot);
  }

  return {
    workspaceRoot,
    fixturesRoot: existsSync(fixturesRoot) ? fixturesRoot : undefined,
    fixtures,
    machineProfiles,
    posts: listBuiltinPosts().map((post) => ({ id: post.id, name: post.name })),
    mcp: {
      command: 'bun',
      args: ['run', 'achar', 'mcp'],
      environment: {
        ACHAR_WORKSPACE: workspaceRoot,
      },
    },
  };
}

async function discoverMachineProfiles(
  root: string,
): Promise<AcharMachineProfileSummary[]> {
  const profilePaths = await findMachineProfilePaths(root);
  const profiles = await Promise.all(
    profilePaths.map(async (profilePath) => {
      const profile = await loadMachineProfile(profilePath);
      return {
        id: profile.id,
        name: profile.name,
        controller: profile.controller,
        axes: profile.axes,
        path: profilePath,
      };
    }),
  );

  return profiles.sort((left, right) => {
    const leftLabel = left.name ?? left.id;
    const rightLabel = right.name ?? right.id;
    return leftLabel.localeCompare(rightLabel);
  });
}

async function findMachineProfilePaths(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findMachineProfilePaths(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.machine.json')) {
      found.push(entryPath);
    }
  }

  return found;
}

async function loadInput(input: AcharInput, root?: string) {
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
    ? await loadMachineProfile(path.resolve(input.machineProfilePath), { root })
    : undefined;
  const diagnostics = [
    ...(vmid ? validateTraceAgainstVmid(events, vmid) : []),
    ...validateMachineProfileCompatibility(machineProfile, events, {
      vmid,
      post: resolveBuiltinPost(input.postId),
    }),
  ] satisfies AcharDiagnostic[];

  return { events, vmid, machineProfile, diagnostics };
}

function assertNoErrors(diagnostics: AcharDiagnostic[]): void {
  const errors = diagnostics.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join('\n'));
  }
}

export async function validateAcharInput(
  input: AcharInput,
  workspaceRoot?: string,
): Promise<AcharValidationResult> {
  const startedAt = performance.now();
  // The root travels with the input so a profile's `extends` chain cannot
  // reach past a sandbox the caller already applied to the profile path.
  const loaded = await loadInput(input, workspaceRoot);
  return {
    eventCount: loaded.events.length,
    durationMs: performance.now() - startedAt,
    diagnostics: loaded.diagnostics,
  };
}

function preview(file: string, code: string): AcharGenerationResult['preview'] {
  return {
    file,
    code: code.slice(0, previewLimit),
    truncated: code.length > previewLimit,
  };
}

export async function generateAcharFiles(
  input: AcharInput,
  workspaceRoot = resolveWorkspaceRoot(),
): Promise<AcharGenerationResult> {
  const startedAt = performance.now();
  const programName = input.programName.trim();
  resolveGeneratedFilePath(workspaceRoot, programName);
  const loaded = await loadInput(input, workspaceRoot);
  assertNoErrors(loaded.diagnostics);

  const post = resolveBuiltinPost(input.postId);
  if (!post) throw new Error(`Unknown built-in post: ${input.postId}`);

  const files = generatePostFiles(loaded.events, programName, (program) =>
    post.registerPost(program, { machineProfile: loaded.machineProfile }),
  );
  const outputPath = path.resolve(
    input.outputPath?.trim() ||
      path.join(workspaceRoot, 'generated', programName),
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

export async function readGeneratedFile(
  outputPath: string,
  file: string,
): Promise<AcharGenerationResult['preview']> {
  const root = path.resolve(outputPath);
  const target = path.resolve(root, file);
  if (path.dirname(target) !== root)
    throw new Error('Invalid output file path.');
  if (!existsSync(target)) throw new Error(`Generated file not found: ${file}`);
  return preview(file, await Bun.file(target).text());
}
