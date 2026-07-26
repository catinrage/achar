import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initPost } from './scaffold';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('post scaffolding', () => {
  it('creates only files consumed by the post runtime and authoring workflow', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'achar-scaffold-'));
    tempDirs.push(parent);
    const target = path.join(parent, 'my-controller');

    await initPost(target, {});

    expect((await readdir(target)).sort()).toEqual([
      'README.md',
      'driver.ts',
      'index.ts',
      'policy.ts',
    ]);
    expect(existsSync(path.join(target, 'post.config.ts'))).toBe(false);
  });
});
