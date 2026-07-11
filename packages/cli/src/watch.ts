import { existsSync, statSync, unwatchFile, watchFile } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedFixture } from '@achar/core';
import { discoverFixtures, loadFixture, resolveBuiltinPost } from '@achar/core';
import chalk from 'chalk';
import { isFixtureTarget } from './inputs';
import type { CliOptions } from './options';
import { printError, printInfo } from './ui';

export async function watchRun(
  target: string,
  options: CliOptions,
  runOnce: () => Promise<number>,
): Promise<number> {
  let running = false;
  let pending = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const execute = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }

    running = true;
    try {
      process.exitCode = await runOnce();
    } catch (error) {
      process.exitCode = 1;
      printError(error instanceof Error ? error.message : String(error));
    } finally {
      running = false;
      if (pending) {
        pending = false;
        await execute();
      }
    }
  };
  const schedule = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      printInfo(chalk.dim('\nChange detected; rerunning...'));
      void execute();
    }, 100);
  };

  await execute();

  const watchPaths = await watchablePaths(target, options);
  for (const watchPath of watchPaths) {
    watchFile(watchPath, { interval: 500 }, (current, previous) => {
      if (
        current.mtimeMs !== previous.mtimeMs ||
        current.size !== previous.size
      ) {
        schedule();
      }
    });
  }
  printInfo(
    chalk.cyan(`Watching ${watchPaths.length} path(s). Press Ctrl+C to stop.`),
  );

  return new Promise((resolve) => {
    process.once('SIGINT', () => {
      for (const watchPath of watchPaths) unwatchFile(watchPath);
      resolve(Number(process.exitCode ?? 0));
    });
  });
}

async function watchablePaths(
  target: string,
  options: CliOptions,
): Promise<string[]> {
  const paths = new Set<string>();

  await addExistingWatchPath(paths, target);

  if (options.all === true) {
    try {
      for (const fixture of await discoverFixtures(target)) {
        await addFixtureWatchPaths(paths, fixture);
      }
    } catch {
      // The command itself will report fixture discovery errors.
    }
  } else if (isFixtureTarget(target)) {
    await addFixtureWatchPaths(paths, await loadFixture(target));
  }

  if (typeof options.reference === 'string')
    await addExistingWatchPath(paths, options.reference);
  if (typeof options.vmid === 'string')
    await addExistingWatchPath(paths, options.vmid);
  if (typeof options.machineProfile === 'string')
    await addExistingWatchPath(paths, options.machineProfile);
  if (typeof options.post === 'string' && !resolveBuiltinPost(options.post)) {
    await addExistingWatchPath(paths, options.post);
  }

  return [...paths];
}

async function addFixtureWatchPaths(
  paths: Set<string>,
  fixture: ResolvedFixture,
): Promise<void> {
  await addExistingWatchPath(
    paths,
    path.join(fixture.root, 'achar.fixture.json'),
  );
  await addExistingWatchPath(paths, fixture.trace);
  await addExistingWatchPath(paths, fixture.reference);
  if (fixture.vmid) await addExistingWatchPath(paths, fixture.vmid);
  if (fixture.machineProfile) {
    await addExistingWatchPath(paths, fixture.machineProfile);
  }
  if (fixture.post && !resolveBuiltinPost(fixture.post)) {
    await addExistingWatchPath(paths, fixture.post);
  }
}

async function addExistingWatchPath(
  paths: Set<string>,
  filePath: string,
): Promise<void> {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) return;

  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    paths.add(resolved);
    return;
  }

  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(MPF|SPF|json|vmid|ts|js)$/i.test(entry.name)) continue;

    paths.add(path.join(resolved, entry.name));
  }
}
