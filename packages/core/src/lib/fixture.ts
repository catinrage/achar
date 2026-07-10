import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { deriveProgramName } from './post-test';

export const FIXTURE_MANIFEST = 'achar.fixture.json';

export interface FixtureManifest {
  name?: string;
  trace: string;
  reference: string;
  programName?: string;
  post?: string;
  out?: string;
  vmid?: string;
  machineProfile?: string;
}

export interface ResolvedFixture {
  name: string;
  root: string;
  trace: string;
  reference: string;
  programName: string;
  post?: string;
  out?: string;
  vmid?: string;
  machineProfile?: string;
}

export async function loadFixture(target: string): Promise<ResolvedFixture> {
  const root = path.resolve(target);
  const manifestPath = path.join(root, FIXTURE_MANIFEST);

  if (!existsSync(manifestPath)) {
    throw new Error(`Missing fixture manifest: ${manifestPath}`);
  }

  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf-8'),
  ) as FixtureManifest;
  const trace = path.resolve(root, manifest.trace);
  const reference = path.resolve(root, manifest.reference);

  return {
    name: manifest.name ?? path.basename(root),
    root,
    trace,
    reference,
    programName: manifest.programName ?? deriveProgramName(trace),
    post: manifest.post,
    out: manifest.out ? path.resolve(root, manifest.out) : undefined,
    vmid: manifest.vmid ? path.resolve(root, manifest.vmid) : undefined,
    machineProfile: manifest.machineProfile
      ? path.resolve(root, manifest.machineProfile)
      : undefined,
  };
}

export async function discoverFixtures(
  root: string,
): Promise<ResolvedFixture[]> {
  const resolvedRoot = path.resolve(root);
  const directManifest = path.join(resolvedRoot, FIXTURE_MANIFEST);
  if (existsSync(directManifest)) {
    return [await loadFixture(resolvedRoot)];
  }

  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const fixtures: ResolvedFixture[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const candidate = path.join(resolvedRoot, entry.name);
    if (existsSync(path.join(candidate, FIXTURE_MANIFEST))) {
      fixtures.push(await loadFixture(candidate));
    }
  }

  if (fixtures.length === 0) {
    throw new Error(`No ${FIXTURE_MANIFEST} files found under ${resolvedRoot}`);
  }

  return fixtures.sort((left, right) => left.name.localeCompare(right.name));
}
