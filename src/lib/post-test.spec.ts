import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerDefaultPost } from './default-post';
import { discoverFixtures } from './fixture';
import { loadMachineProfile } from './machine-profile';
import {
  assertPostMatchesReference,
  formatCompareResults,
  testPost,
} from './post-test';
import { parseVmidFile } from './vmid';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'achar-post-test-'));
  tempDirs.push(dir);
  return dir;
}

async function writeFixture(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(root, file);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('post test harness', () => {
  it('lets a post test pass against golden output', async () => {
    const root = await makeTempDir();
    const trace = path.join(root, 'trace.MPF');
    const reference = path.join(root, 'reference');

    await writeFixture(root, {
      'trace.MPF': '(0)@start_of_file\n',
      'reference/Test.MPF': 'N10 G0',
    });

    const result = await testPost({
      trace,
      reference,
      programName: 'Test',
      registerPost: (program) => {
        program.on('StartOfFile', ($) => {
          $.put('G0');
        });
      },
    });

    expect(result.summary).toEqual({
      match: 1,
      different: 0,
      missingGenerated: 0,
      missingReference: 0,
    });
    expect(() => assertPostMatchesReference(result)).not.toThrow();
  });

  it('fails with the first differing line when golden output changes', async () => {
    const root = await makeTempDir();
    const trace = path.join(root, 'trace.MPF');
    const reference = path.join(root, 'reference');

    await writeFixture(root, {
      'trace.MPF': '(0)@start_of_file\n',
      'reference/Test.MPF': 'N10 G1',
    });

    const result = await testPost({
      trace,
      reference,
      programName: 'Test',
      registerPost: (program) => {
        program.on('StartOfFile', ($) => {
          $.put('G0');
        });
      },
    });

    expect(result.summary.different).toBe(1);
    expect(formatCompareResults(result.results)).toContain(
      'Test.MPF  different  1',
    );
    expect(() => assertPostMatchesReference(result)).toThrow(
      /expected: N10 G1/,
    );
  });
});

const fixtureRoot = path.resolve(__dirname, '../../fixtures');
const realFixtures = existsSync(fixtureRoot)
  ? await Promise.all(
      (await discoverFixtures(fixtureRoot))
        .filter((fixture) => fixture.post === 'siemens-828d')
        .map(async (fixture) => ({
          fixture,
          machineProfile: fixture.machineProfile
            ? await loadMachineProfile(fixture.machineProfile)
            : undefined,
          vmid: fixture.vmid ? await parseVmidFile(fixture.vmid) : undefined,
        })),
    )
  : [];

describe('real Siemens fixture parity', () => {
  for (const { fixture, machineProfile, vmid } of realFixtures) {
    it(`${fixture.name} matches every reference file`, async () => {
      const result = await testPost({
        trace: fixture.trace,
        reference: fixture.reference,
        programName: fixture.programName,
        registerPost: (program) =>
          registerDefaultPost(program, { machineProfile }),
        compare: { allReferenceFiles: true },
        vmid,
        machineProfile,
      });

      expect(result.summary.missingGenerated).toBe(0);
      expect(result.summary.missingReference).toBe(0);
      expect(result.summary.different).toBe(0);
      expect(result.summary.match).toBeGreaterThan(0);
      expect(() => assertPostMatchesReference(result)).not.toThrow();
    }, 15_000);
  }

  if (realFixtures.length === 0) {
    it.skip('has no fixture manifests under fixtures/', () => {});
  }
});
