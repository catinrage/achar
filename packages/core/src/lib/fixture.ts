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
  /**
   * When true, the fixture is skipped by fixture discovery and therefore
   * excluded from parity and all other test runs. Directly targeting the
   * fixture (e.g. `achar test <dir>`) still works.
   */
  ignored?: boolean;
}

export interface DiscoverFixturesOptions {
  /** Include fixtures whose manifest sets `ignored: true`. */
  includeIgnored?: boolean;
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
  ignored: boolean;
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
  if (manifest.ignored !== undefined && typeof manifest.ignored !== 'boolean') {
    throw new Error(
      `Invalid "ignored" value in ${manifestPath}: expected a boolean`,
    );
  }
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
    ignored: manifest.ignored === true,
  };
}

/**
 * Discovers fixtures under a directory. Fixtures whose manifest sets
 * `ignored: true` are excluded by default so every test consumer skips
 * them automatically; pass `includeIgnored` for browsing surfaces that
 * should still list them.
 */
export async function discoverFixtures(
  root: string,
  options: DiscoverFixturesOptions = {},
): Promise<ResolvedFixture[]> {
  const resolvedRoot = path.resolve(root);
  const includeIgnored = options.includeIgnored === true;
  const fixtures: ResolvedFixture[] = [];

  const directManifest = path.join(resolvedRoot, FIXTURE_MANIFEST);
  if (existsSync(directManifest)) {
    fixtures.push(await loadFixture(resolvedRoot));
  } else {
    const entries = await readdir(resolvedRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const candidate = path.join(resolvedRoot, entry.name);
      if (existsSync(path.join(candidate, FIXTURE_MANIFEST))) {
        fixtures.push(await loadFixture(candidate));
      }
    }
  }

  if (fixtures.length === 0) {
    throw new Error(`No ${FIXTURE_MANIFEST} files found under ${resolvedRoot}`);
  }

  return fixtures
    .filter((fixture) => includeIgnored || !fixture.ignored)
    .sort((left, right) => left.name.localeCompare(right.name));
}
