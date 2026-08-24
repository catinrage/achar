import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { WorkerPool } from '@achar/server';
import type { DataPaths } from '../data/paths';
import {
  jobOutputDirectory,
  jobTracePath,
  prepareDataPaths,
} from '../data/paths';
import { JobStore } from '../data/store';
import { describeJob, JobRunner } from './runner';

/**
 * Retention and restart behaviour.
 *
 * These matter because they are the parts nobody exercises by hand: a volume
 * fills up over months, and a restart happens when someone is already having
 * a bad day.
 */

let paths: DataPaths;
let store: JobStore;
let pool: WorkerPool;
let runner: JobRunner;
let root: string;

beforeEach(() => {
  root = path.join('/tmp', `achar-runner-spec-${Bun.randomUUIDv7()}`);
  paths = prepareDataPaths(root);
  store = new JobStore(paths);
  pool = new WorkerPool({ size: 1 });
  runner = new JobRunner(store, paths, pool, { retentionDays: 14 });
});

afterEach(async () => {
  runner.stopRetentionSweep();
  await pool.shutdown();
  store.close();
  await rm(root, { recursive: true, force: true });
});

/** Reads back a job the test just created, failing loudly if it vanished. */
function requireJob(id: string) {
  const job = store.findJob(id);
  if (!job) throw new Error(`The test job '${id}' was not stored.`);
  return job;
}

/** Creates a finished job with a trace and one output file on disk. */
async function seedFinishedJob(id: string, createdAt?: number) {
  store.upsertMachine({
    id: 'm1',
    name: 'Machine',
    postId: 'siemens-828d',
    vmidFile: null,
    profileFile: null,
    createdAt: Date.now(),
  });
  store.createJob({
    id,
    traceSha256: `sha-${id}`,
    traceName: `${id}.MPF`,
    traceBytes: 1234,
    machineId: 'm1',
    programName: null,
  });
  await Bun.write(jobTracePath(paths, id), 'trace bytes');
  await Bun.write(
    path.join(jobOutputDirectory(paths, id), 'OUT.SPF'),
    'N10 G0\n',
  );
  store.markDone(id, {
    files: [{ name: 'OUT.SPF', bytes: 8, lines: 2 }],
    diagnostics: [],
    timing: { duration: '0:01:00' },
    profile: null,
  });

  if (createdAt !== undefined) age(id, createdAt);
}

/**
 * Back-dates a job so retention can be tested without waiting two weeks.
 *
 * Done over a second connection to the same file rather than through
 * `JobStore`, which has no reason to expose a way to rewrite history.
 */
function age(id: string, createdAt: number): void {
  const db = new Database(paths.database);
  try {
    db.query('UPDATE jobs SET created_at = ? WHERE id = ?').run(createdAt, id);
  } finally {
    db.close();
  }
}

describe('retention', () => {
  it('deletes an expired trace but keeps the job and its output', async () => {
    const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
    await seedFinishedJob('old', fifteenDaysAgo);

    const purged = await runner.purgeExpiredTraces();

    expect(purged).toBe(1);
    expect(await Bun.file(jobTracePath(paths, 'old')).exists()).toBe(false);
    // The kilobytes stay; only the hundreds of megabytes go.
    expect(
      await Bun.file(
        path.join(jobOutputDirectory(paths, 'old'), 'OUT.SPF'),
      ).exists(),
    ).toBe(true);

    const job = store.findJob('old');
    expect(job?.status).toBe('done');
    expect(job?.tracePurgedAt).not.toBeNull();
    expect(store.listFiles('old')).toHaveLength(1);
  });

  it('leaves a trace inside the retention window alone', async () => {
    await seedFinishedJob('recent');

    expect(await runner.purgeExpiredTraces()).toBe(0);
    expect(await Bun.file(jobTracePath(paths, 'recent')).exists()).toBe(true);
    expect(store.findJob('recent')?.tracePurgedAt).toBeNull();
  });

  it('does not purge the same trace twice', async () => {
    await seedFinishedJob('once', Date.now() - 20 * 24 * 60 * 60 * 1000);

    expect(await runner.purgeExpiredTraces()).toBe(1);
    expect(await runner.purgeExpiredTraces()).toBe(0);
  });

  it('stops a purged job from serving a stale cache hit', async () => {
    // The trace is gone, so the job can no longer be re-run or verified; a
    // matching upload has to be treated as new work.
    await seedFinishedJob('stale', Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(store.findCachedJob('sha-stale', 'm1')?.id).toBe('stale');

    await runner.purgeExpiredTraces();

    expect(store.findCachedJob('sha-stale', 'm1')).toBeUndefined();
  });
});

describe('recovery', () => {
  it('re-queues a job left running by a restart', () => {
    store.upsertMachine({
      id: 'm1',
      name: 'Machine',
      postId: 'siemens-828d',
      vmidFile: null,
      profileFile: null,
      createdAt: Date.now(),
    });
    store.createJob({
      id: 'interrupted',
      traceSha256: 'sha',
      traceName: 't.MPF',
      traceBytes: 10,
      machineId: 'm1',
      programName: null,
    });
    store.markRunning('interrupted');

    expect(store.requeueInterrupted()).toBe(1);
    expect(store.findJob('interrupted')?.status).toBe('queued');
    expect(store.findJob('interrupted')?.startedAt).toBeNull();
  });
});

describe('describeJob', () => {
  it('reports a queue position only while the job is queued', async () => {
    store.upsertMachine({
      id: 'm1',
      name: 'Machine',
      postId: 'siemens-828d',
      vmidFile: null,
      profileFile: null,
      createdAt: Date.now(),
    });
    store.createJob({
      id: 'first',
      traceSha256: 'a',
      traceName: 'a.MPF',
      traceBytes: 1,
      machineId: 'm1',
      programName: null,
    });
    await Bun.sleep(2);
    store.createJob({
      id: 'second',
      traceSha256: 'b',
      traceName: 'b.MPF',
      traceBytes: 1,
      machineId: 'm1',
      programName: null,
    });

    expect(describeJob(store, requireJob('first')).position).toBe(1);
    expect(describeJob(store, requireJob('second')).position).toBe(2);

    store.markRunning('first');
    expect(describeJob(store, requireJob('first')).position).toBeUndefined();
    // The queue closes up behind it.
    expect(describeJob(store, requireJob('second')).position).toBe(1);
  });

  it('names the machine a job was posted for', async () => {
    await seedFinishedJob('named');

    const view = describeJob(store, requireJob('named'));
    expect(view.machineName).toBe('Machine');
    expect(view.blocked).toBe(false);
    expect(view.files).toHaveLength(1);
  });
});
