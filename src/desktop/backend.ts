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
  summarizeCompareResults,
  writeGeneratedFiles,
} from '../lib/post-test';
import { parseVmidFile, validateTraceAgainstVmid } from '../lib/vmid';
import type {
  DesktopBootstrap,
  DesktopDiagnostic,
  DesktopFixture,
  DesktopInput,
  DesktopMachineProfile,
  GenerationResult,
  ValidationResult,
} from './rpc';

const previewLimit = 180_000;

export function resolveWorkspaceRoot(): string {
  const candidates = [
    Bun.env.ACHAR_WORKSPACE,
    process.cwd(),
    path.resolve(import.meta.dir, '../..'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return (
    candidates.find((candidate) =>
      existsSync(path.join(candidate, 'package.json')),
    ) ?? process.cwd()
  );
}

export async function bootstrapAchar(
  workspaceRoot = resolveWorkspaceRoot(),
): Promise<DesktopBootstrap> {
  const fixturesRoot = path.join(workspaceRoot, 'fixtures');
  let fixtures: DesktopFixture[] = [];
  let machineProfiles: DesktopMachineProfile[] = [];

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
      args: ['src/cli.ts', 'mcp'],
      environment: {
        ACHAR_WORKSPACE: workspaceRoot,
      },
    },
  };
}

async function discoverMachineProfiles(
  root: string,
): Promise<DesktopMachineProfile[]> {
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

export async function validateAcharInput(
  input: DesktopInput,
): Promise<ValidationResult> {
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

export async function generateAcharFiles(
  input: DesktopInput,
  workspaceRoot = resolveWorkspaceRoot(),
): Promise<GenerationResult> {
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

export async function readGeneratedFile(
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
