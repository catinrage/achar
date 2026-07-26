import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { constrainAcharInput, resolveInsideWorkspace } from './workspace-paths';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('MCP workspace paths', () => {
  it('resolves every Achar input path inside the workspace', async () => {
    const workspace = await makeTempDir('achar-mcp-workspace-');
    await mkdir(path.join(workspace, 'inputs'));
    await writeFile(path.join(workspace, 'inputs', 'trace.MPF'), 'trace');

    expect(
      constrainAcharInput(workspace, {
        tracePath: 'inputs/trace.MPF',
        vmidPath: 'inputs/machine.vmid',
        machineProfilePath: 'inputs/machine.json',
        referencePath: 'reference',
        outputPath: 'generated/Test',
        programName: 'Test',
        postId: 'siemens-828d',
      }),
    ).toEqual({
      tracePath: path.join(workspace, 'inputs', 'trace.MPF'),
      vmidPath: path.join(workspace, 'inputs', 'machine.vmid'),
      machineProfilePath: path.join(workspace, 'inputs', 'machine.json'),
      referencePath: path.join(workspace, 'reference'),
      outputPath: path.join(workspace, 'generated', 'Test'),
      programName: 'Test',
      postId: 'siemens-828d',
    });
  });

  it('rejects lexical traversal and absolute paths outside the workspace', async () => {
    const workspace = await makeTempDir('achar-mcp-workspace-');
    const outside = await makeTempDir('achar-mcp-outside-');

    expect(() =>
      resolveInsideWorkspace(workspace, '../secret.MPF', 'tracePath'),
    ).toThrow('must stay inside the workspace root');
    expect(() =>
      resolveInsideWorkspace(
        workspace,
        path.join(outside, 'secret.MPF'),
        'tracePath',
      ),
    ).toThrow('must stay inside the workspace root');
  });

  it('rejects a symlink ancestor that points outside the workspace', async () => {
    if (process.platform === 'win32') return;

    const workspace = await makeTempDir('achar-mcp-workspace-');
    const outside = await makeTempDir('achar-mcp-outside-');
    await symlink(outside, path.join(workspace, 'linked'));

    expect(() =>
      resolveInsideWorkspace(workspace, 'linked/secret.MPF', 'tracePath'),
    ).toThrow('must not traverse a symlink outside');
  });
});
