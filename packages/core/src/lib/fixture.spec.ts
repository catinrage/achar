import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverFixtures, loadFixture } from './fixture';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'achar-fixture-'));
  tempDirs.push(dir);
  return dir;
}

async function writeFixtureDir(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'achar.fixture.json'),
    JSON.stringify({ trace: 'trace.MPF', reference: 'reference', ...manifest }),
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('fixture ignored flag', () => {
  it('defaults ignored to false', async () => {
    const root = await makeTempDir();
    await writeFixtureDir(root, 'plain', {});

    const fixture = await loadFixture(path.join(root, 'plain'));
    expect(fixture.ignored).toBe(false);
  });

  it('parses an explicit ignored: true', async () => {
    const root = await makeTempDir();
    await writeFixtureDir(root, 'skipped', { ignored: true });

    const fixture = await loadFixture(path.join(root, 'skipped'));
    expect(fixture.ignored).toBe(true);
  });

  it('rejects non-boolean ignored values', async () => {
    const root = await makeTempDir();
    await writeFixtureDir(root, 'broken', { ignored: 'yes' });

    await expect(loadFixture(path.join(root, 'broken'))).rejects.toThrow(
      /expected a boolean/,
    );
  });

  it('excludes ignored fixtures from discovery by default', async () => {
    const root = await makeTempDir();
    await writeFixtureDir(root, 'active', { name: 'active' });
    await writeFixtureDir(root, 'skipped', { name: 'skipped', ignored: true });

    const discovered = await discoverFixtures(root);
    expect(discovered.map((fixture) => fixture.name)).toEqual(['active']);
  });

  it('includes ignored fixtures when includeIgnored is set', async () => {
    const root = await makeTempDir();
    await writeFixtureDir(root, 'active', { name: 'active' });
    await writeFixtureDir(root, 'skipped', { name: 'skipped', ignored: true });

    const discovered = await discoverFixtures(root, { includeIgnored: true });
    expect(discovered.map((fixture) => fixture.name)).toEqual([
      'active',
      'skipped',
    ]);
  });

  it('returns an empty list when every fixture is ignored', async () => {
    const root = await makeTempDir();
    await writeFixtureDir(root, 'skipped', { ignored: true });

    const discovered = await discoverFixtures(root);
    expect(discovered).toHaveLength(0);
  });
});
