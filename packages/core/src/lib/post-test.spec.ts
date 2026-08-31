import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerDefaultPost } from './default-post';
import { discoverFixtures } from './fixture';
import { loadMachineProfile } from './machine-profile';
import type { CompareOptions, CompareResult, GeneratedFile } from './post-test';
import {
  assertPostMatchesReference,
  compareAgainstReference,
  compareFileLifecycle,
  compareGeneratedFiles,
  formatCompareResults,
  readTraceFileLifecycle,
  resolveGeneratedFilePath,
  summarizeCompareResults,
  testPost,
  writeGeneratedFiles,
} from './post-test';
import type { Program } from './program';
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

  it('flags pure N-number drift and ignores it with ignoreLineNumbers', async () => {
    const root = await makeTempDir();
    const trace = path.join(root, 'trace.MPF');
    const reference = path.join(root, 'reference');

    // Same G-code content, shifted block numbers.
    await writeFixture(root, {
      'trace.MPF': '(0)@start_of_file\n',
      'reference/Test.MPF': 'N20 G0\nN30 M30',
    });

    const registerPost = (program: Program) => {
      program.on('StartOfFile', ($) => {
        $.put('G0');
        $.put('M30');
      });
    };

    const drifted = await testPost({
      trace,
      reference,
      programName: 'Test',
      registerPost,
    });
    expect(drifted.summary.different).toBe(1);
    expect(drifted.results[0]?.numberingDriftOnly).toBe(true);
    expect(formatCompareResults(drifted.results)).toContain(
      'different (numbering)',
    );

    const ignored = await testPost({
      trace,
      reference,
      programName: 'Test',
      registerPost,
      compare: { ignoreLineNumbers: true },
    });
    expect(ignored.summary).toEqual({
      match: 1,
      different: 0,
      missingGenerated: 0,
      missingReference: 0,
    });
  });

  it('does not mark real content differences as numbering drift', async () => {
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

    expect(result.results[0]?.numberingDriftOnly).toBe(false);
  });
});

describe('generated file containment', () => {
  it('writes plain generated file names into the requested directory', async () => {
    const root = await makeTempDir();

    await writeGeneratedFiles([{ file: 'MAIN.MPF', code: 'N10 M30' }], root);

    expect(await Bun.file(path.join(root, 'MAIN.MPF')).text()).toBe('N10 M30');
  });

  it('rejects traversal and platform-specific separators before writing', async () => {
    const root = await makeTempDir();

    for (const file of [
      '../escape.MPF',
      'nested/escape.MPF',
      String.raw`nested\escape.MPF`,
      '..',
    ]) {
      expect(() => resolveGeneratedFilePath(root, file)).toThrow(
        'must be a plain file name',
      );
    }

    await expect(
      writeGeneratedFiles(
        [
          { file: 'SAFE.MPF', code: 'safe' },
          { file: '../escape.MPF', code: 'escape' },
        ],
        root,
      ),
    ).rejects.toThrow('must be a plain file name');
    expect(existsSync(path.join(root, 'SAFE.MPF'))).toBe(false);
  });
});

describe('compareGeneratedFiles', () => {
  const generated: GeneratedFile[] = [
    { file: 'MAIN.MPF', code: 'N10 G0\nN20 M30' },
    { file: 'SUB_1.SPF', code: 'N10 G1' },
    { file: 'EXTRA.SPF', code: 'N10 G2' },
  ];
  const reference: GeneratedFile[] = [
    { file: 'MAIN.MPF', code: 'N10 G0\nN20 M30' },
    { file: 'SUB-1.SPF', code: 'N10 G1' },
    { file: 'ORPHAN.SPF', code: 'N10 G3' },
  ];

  /** Runs the same comparison through both entry points. */
  async function bothWays(
    options?: CompareOptions,
  ): Promise<{ inMemory: CompareResult[]; fromDisk: CompareResult[] }> {
    const root = await makeTempDir();
    await writeFixture(
      root,
      Object.fromEntries(reference.map((file) => [file.file, file.code])),
    );
    // A reference directory in the wild holds more than NC files.
    await writeFixture(root, { 'notes.txt': 'ignored' });

    return {
      inMemory: compareGeneratedFiles(generated, reference, options),
      fromDisk: await compareAgainstReference(generated, root, options),
    };
  }

  it('matches compareAgainstReference on the default options', async () => {
    const { inMemory, fromDisk } = await bothWays();

    expect(inMemory).toEqual(fromDisk);
    expect(inMemory).toEqual([
      { file: 'EXTRA.SPF', status: 'missing-reference' },
      { file: 'MAIN.MPF', status: 'match' },
      // Punctuation-normalized name match is reported as a rename.
      { file: 'SUB-1.SPF <- SUB_1.SPF', status: 'match' },
    ]);
  });

  it('matches compareAgainstReference with allReferenceFiles', async () => {
    const { inMemory, fromDisk } = await bothWays({
      allReferenceFiles: true,
    });

    expect(inMemory).toEqual(fromDisk);
    expect(summarizeCompareResults(inMemory)).toEqual({
      match: 2,
      different: 0,
      missingGenerated: 1,
      missingReference: 1,
    });
  });

  it('matches compareAgainstReference on differing content', async () => {
    const changed = [{ file: 'MAIN.MPF', code: 'N10 G0\nN20 M02' }];
    const root = await makeTempDir();
    await writeFixture(root, { 'MAIN.MPF': 'N10 G0\nN20 M30' });

    const inMemory = compareGeneratedFiles(changed, [
      { file: 'MAIN.MPF', code: 'N10 G0\nN20 M30' },
    ]);
    const fromDisk = await compareAgainstReference(changed, root);

    expect(inMemory).toEqual(fromDisk);
    expect(inMemory[0]).toMatchObject({
      file: 'MAIN.MPF',
      status: 'different',
      firstDifference: 2,
      expected: 'N20 M30',
      actual: 'N20 M02',
      numberingDriftOnly: false,
    });
  });

  it('normalizes N-number drift the same way as the directory path', async () => {
    const shifted = [{ file: 'MAIN.MPF', code: 'N10 G0\nN20 M30' }];
    const root = await makeTempDir();
    await writeFixture(root, { 'MAIN.MPF': 'N20 G0\nN30 M30' });
    const referenceFiles = [{ file: 'MAIN.MPF', code: 'N20 G0\nN30 M30' }];

    expect(compareGeneratedFiles(shifted, referenceFiles)[0]).toEqual(
      (await compareAgainstReference(shifted, root))[0],
    );
    expect(compareGeneratedFiles(shifted, referenceFiles)[0]).toMatchObject({
      status: 'different',
      numberingDriftOnly: true,
    });
    expect(
      compareGeneratedFiles(shifted, referenceFiles, {
        ignoreLineNumbers: true,
      })[0],
    ).toEqual({ file: 'MAIN.MPF', status: 'match' });
  });

  it('reports an empty reference as all missing', () => {
    expect(compareGeneratedFiles(generated, [])).toEqual([
      { file: 'EXTRA.SPF', status: 'missing-reference' },
      { file: 'MAIN.MPF', status: 'missing-reference' },
      { file: 'SUB_1.SPF', status: 'missing-reference' },
    ]);
  });
});

const fixtureRoot = path.resolve(__dirname, '../../../../fixtures');
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

const parityBaseline: Record<
  string,
  {
    match: number;
    different: number;
    missingGenerated: number;
    missingReference: number;
  }
> = {
  // Re-posted 2026-08-30 with the current GPP, which deletes a repeated
  // subprogram file for 4x patterns as well as translate ones.
  'siemens-828d-2541021-cam-milling': {
    match: 38,
    different: 0,
    missingGenerated: 0,
    missingReference: 0,
  },
  'siemens-828d-b0577-cam-milling': {
    match: 37,
    different: 0,
    missingGenerated: 0,
    missingReference: 0,
  },
  'siemens-828d-2551019-cam-milling': {
    match: 92,
    different: 0,
    missingGenerated: 0,
    missingReference: 0,
  },
  'siemens-828d-26646-cam-milling': {
    match: 25,
    different: 0,
    missingGenerated: 0,
    missingReference: 0,
  },
  'siemens-828d-434-cam-2-milling': {
    match: 25,
    different: 0,
    missingGenerated: 0,
    missingReference: 0,
  },
  'siemens-828d-567-1160l-3a-cam-milling': {
    match: 22,
    different: 0,
    missingGenerated: 0,
    missingReference: 0,
  },
  'siemens-828d-431-cam-milling': {
    match: 11,
    different: 0,
    missingGenerated: 0,
    missingReference: 0,
  },
  'siemens-828d-ag-big-sabet-cam-milling': {
    match: 37,
    different: 0,
    missingGenerated: 0,
    missingReference: 0,
  },
};

describe('real Siemens fixture parity', () => {
  for (const { fixture, machineProfile, vmid } of realFixtures) {
    it(`${fixture.name} matches its recorded parity baseline`, async () => {
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

      const expected = parityBaseline[fixture.name];
      if (!expected) {
        throw new Error(`Missing parity baseline for ${fixture.name}`);
      }
      expect(result.summary).toEqual(expected);

      if (
        expected.different === 0 &&
        expected.missingGenerated === 0 &&
        expected.missingReference === 0
      ) {
        expect(() => assertPostMatchesReference(result)).not.toThrow();
      } else {
        expect(() => assertPostMatchesReference(result)).toThrow();
      }
    }, 15_000);
  }

  if (realFixtures.length === 0) {
    it.skip('has no fixture manifests under fixtures/', () => {});
  }
});

describe('trace file lifecycle', () => {
  const trace = [
    "(1)@start_of_job    ==> job_name:'a'",
    '                      > !! open file = A.SPF !!',
    '                      > !! close file = A.SPF !!',
    "(1)@start_of_job    ==> job_name:'b'",
    '                      > !! delete file = B.SPF !!',
    '                      > !! open file = B.SPF !!',
    '                      > !! close file = B.SPF !!',
    "(1)@start_of_job    ==> job_name:'b'",
    '                      > !! delete file = B.SPF !!',
    '                      > !! open file = B.SPF !!',
    '                      > !! close file = B.SPF !!',
    '                      > !! open file = Tools.MPF !!',
    '                      > !! open file = Tools.MPF !!',
  ].join('\n');

  it('reads a delete-before-open as a truncating open', () => {
    expect(readTraceFileLifecycle(trace)).toEqual([
      { file: 'A.SPF', opens: ['append'] },
      { file: 'B.SPF', opens: ['replace', 'replace'] },
      { file: 'Tools.MPF', opens: ['append', 'append'] },
    ]);
  });

  it('finds nothing in a trace that records no file directives', () => {
    expect(readTraceFileLifecycle("(1)@start_of_job ==> job_name:'a'")).toEqual(
      [],
    );
    // No directives means no expectation, not a mismatch against every file.
    expect(
      compareFileLifecycle([], [{ file: 'B.SPF', mode: 'append' }]),
    ).toEqual([]);
  });

  it('reports a post that appends where the trace truncates', () => {
    const issues = compareFileLifecycle(readTraceFileLifecycle(trace), [
      { file: 'A.SPF', mode: 'replace' },
      { file: 'B.SPF', mode: 'replace' },
      { file: 'B.SPF', mode: 'append' },
    ]);

    expect(issues).toEqual([
      {
        file: 'B.SPF',
        traceOpens: 2,
        postOpens: 2,
        traceTruncates: true,
        postTruncates: false,
      },
    ]);
  });

  it('ignores open counts on a file no one truncates', () => {
    // Identical bytes can come from a different number of appends, so
    // counting opens would fail output the reference already proves correct.
    expect(
      compareFileLifecycle(readTraceFileLifecycle(trace), [
        { file: 'A.SPF', mode: 'append' },
        { file: 'B.SPF', mode: 'replace' },
        { file: 'B.SPF', mode: 'replace' },
        { file: 'Tools.MPF', mode: 'append' },
        { file: 'Tools.MPF', mode: 'append' },
        { file: 'Tools.MPF', mode: 'append' },
      ]),
    ).toEqual([]);
  });
});
