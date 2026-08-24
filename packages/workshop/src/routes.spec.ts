import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { TIMED_TRACE, UNTIMED_TRACE } from '@achar/server/fixtures.spec-helper';
import type { WorkshopServer } from './workshop';
import { startWorkshopServer } from './workshop';

/**
 * End-to-end coverage of the browser-facing service: upload, queue, results,
 * downloads and the content-hash cache.
 *
 * These go through real HTTP rather than calling the handlers directly,
 * because the parts most likely to break — streaming an upload to disk,
 * dispatching to a worker, serving a file back — only exist at that boundary.
 */

let server: WorkshopServer;
let base: string;
let dataDir: string;
let machineId: string;

beforeAll(async () => {
  dataDir = path.join('/tmp', `achar-workshop-spec-${Bun.randomUUIDv7()}`);
  server = await startWorkshopServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    // The UI has no token to present; /api is open by design.
    token: 'unused-by-the-api-routes',
  });
  base = `http://127.0.0.1:${server.port}`;

  const form = new FormData();
  form.set('name', 'Test Machine');
  form.set('postId', 'siemens-828d');
  const created = await fetch(`${base}/api/machines`, {
    method: 'POST',
    body: form,
  });
  machineId = (await created.json()).machine.id;
});

afterAll(async () => {
  await server.stop();
  await rm(dataDir, { recursive: true, force: true });
});

/** Uploads a trace the way the browser does: raw body, options in the query. */
function upload(
  trace: string,
  options: { machineId?: string; filename?: string; programName?: string } = {},
): Promise<Response> {
  const query = new URLSearchParams({
    machineId: options.machineId ?? machineId,
    filename: options.filename ?? 'test.MPF',
  });
  if (options.programName) query.set('programName', options.programName);

  return fetch(`${base}/api/jobs?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: trace,
  });
}

/** Polls until the job leaves the queue, as the UI does. */
async function settle(jobId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${base}/api/jobs/${jobId}`);
    const { job } = await response.json();
    if (job.status === 'done' || job.status === 'failed') return job;
    await Bun.sleep(50);
  }
  throw new Error('The job never settled.');
}

describe('machines', () => {
  it('lists the machine created for these tests', async () => {
    const response = await fetch(`${base}/api/machines`);

    expect(response.status).toBe(200);
    const { machines } = await response.json();
    expect(machines).toContainEqual({
      id: machineId,
      name: 'Test Machine',
      postId: 'siemens-828d',
      postName: 'Siemens 828D Milling 4A',
      hasVmid: false,
      hasProfile: false,
    });
  });

  it('serves the post list the machine form needs', async () => {
    const { posts } = await (await fetch(`${base}/api/posts`)).json();
    expect(posts).toContainEqual({
      id: 'siemens-828d',
      name: 'Siemens 828D Milling 4A',
    });
  });
});

describe('POST /api/jobs', () => {
  it('accepts an upload and reports it as queued', async () => {
    const response = await upload(TIMED_TRACE, { filename: 'queued.MPF' });

    expect(response.status).toBe(202);
    const { job, cached } = await response.json();
    expect(cached).toBe(false);
    expect(job.status).toBe('queued');
    expect(job.position).toBe(1);
    expect(job.traceName).toBe('queued.MPF');
    expect(job.traceBytes).toBe(Buffer.byteLength(TIMED_TRACE, 'utf-8'));
  });

  it('produces G-code, cycle time and a tool list from one upload', async () => {
    const { job } = await (
      await upload(TIMED_TRACE, { filename: 'complete.MPF' })
    ).json();
    const settled = await settle(job.id);

    expect(settled.status).toBe('done');
    expect(settled.blocked).toBe(false);
    expect(settled.files.length).toBeGreaterThan(0);
    // The three panels of the results page, all from the same parse.
    expect(settled.timing.duration).toMatch(/^\d+:\d{2}:\d{2}$/);
    expect(settled.profile.tools.length).toBeGreaterThan(0);
    expect(settled.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('honours an explicit program name', async () => {
    const { job } = await (
      await upload(TIMED_TRACE, {
        filename: 'named.MPF',
        programName: 'CUSTOM_NAME',
      })
    ).json();
    const settled = await settle(job.id);

    expect(settled.programName).toBe('CUSTOM_NAME');
    expect(
      settled.files.some((file: { name: string }) =>
        file.name.startsWith('CUSTOM_NAME'),
      ),
    ).toBe(true);
  });

  it('rejects an unknown machine', async () => {
    const response = await upload(TIMED_TRACE, {
      machineId: 'no-such-machine',
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('bad-request');
  });

  it('rejects a body that is not a Trace 5 file', async () => {
    const { job } = await (
      await upload('this is not a trace', { filename: 'garbage.MPF' })
    ).json();
    const settled = await settle(job.id);

    expect(settled.status).toBe('failed');
    expect(settled.error).toContain('Trace 5');
  });

  it('rejects an empty upload', async () => {
    const response = await upload('', { filename: 'empty.MPF' });
    expect(response.status).toBe(400);
  });

  it('records a trace refused on content as done-but-blocked', async () => {
    // An untimed trace parses and yields diagnostics rather than G-code. It is
    // a finished job, not a failed one: the operator still gets the reason,
    // plus whatever could be extracted anyway.
    const { job } = await (
      await upload(UNTIMED_TRACE, { filename: 'untimed.MPF' })
    ).json();
    const settled = await settle(job.id);

    expect(settled.status).toBe('done');
    expect(settled.blocked).toBe(true);
    expect(settled.files).toHaveLength(0);
    // `no-timing-data` is raised by the product profile, not by trace or VMID
    // validation, so this also pins that those diagnostics reach the job.
    expect(settled.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'no-timing-data' }),
    );
    expect(settled.profile).not.toBeNull();
  });
});

describe('the content-hash cache', () => {
  it('returns the earlier job for an identical trace and machine', async () => {
    const first = await (
      await upload(TIMED_TRACE, { filename: 'cache-me.MPF' })
    ).json();
    await settle(first.job.id);

    const response = await upload(TIMED_TRACE, { filename: 'cache-me.MPF' });
    const second = await response.json();

    expect(response.status).toBe(200);
    expect(second.cached).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.status).toBe('done');
  });

  it('does not reuse a job across machines', async () => {
    const form = new FormData();
    form.set('name', 'Other Machine');
    form.set('postId', 'siemens-828d');
    const other = (
      await (
        await fetch(`${base}/api/machines`, { method: 'POST', body: form })
      ).json()
    ).machine.id;

    const response = await upload(TIMED_TRACE, {
      machineId: other,
      filename: 'cache-me.MPF',
    });

    expect(response.status).toBe(202);
    expect((await response.json()).cached).toBe(false);
  });
});

describe('downloads', () => {
  it('serves a single generated file as an attachment', async () => {
    const { job } = await (
      await upload(TIMED_TRACE, { filename: 'download.MPF', programName: 'DL' })
    ).json();
    const settled = await settle(job.id);
    const name = settled.files[0].name;

    const response = await fetch(
      `${base}/api/jobs/${job.id}/files/${encodeURIComponent(name)}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect((await response.text()).length).toBeGreaterThan(0);
  });

  it('serves every file as one ZIP', async () => {
    const { job } = await (
      await upload(TIMED_TRACE, { filename: 'zip.MPF', programName: 'ZIPPED' })
    ).json();
    const settled = await settle(job.id);

    const response = await fetch(`${base}/api/jobs/${job.id}/archive`);
    const archive = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    // "PK\x03\x04" — the local file header every ZIP opens with.
    expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(archive.byteLength).toBeGreaterThan(settled.files.length * 20);
  });

  it('refuses a filename the job did not produce', async () => {
    const { job } = await (
      await upload(TIMED_TRACE, { filename: 'guard.MPF', programName: 'GUARD' })
    ).json();
    await settle(job.id);

    // The name is matched against the job's recorded output before it is ever
    // joined to a path, so traversal cannot reach outside the job directory.
    const response = await fetch(
      `${base}/api/jobs/${job.id}/files/${encodeURIComponent('../../../etc/passwd')}`,
    );

    expect(response.status).toBe(404);
  });

  it('404s an unknown job', async () => {
    expect((await fetch(`${base}/api/jobs/does-not-exist`)).status).toBe(404);
  });
});

describe('history', () => {
  it('lists recent jobs, newest first', async () => {
    const response = await fetch(`${base}/api/jobs?limit=5`);

    expect(response.status).toBe(200);
    const { jobs } = await response.json();
    expect(jobs.length).toBeGreaterThan(0);
    for (let index = 1; index < jobs.length; index += 1) {
      expect(jobs[index - 1].createdAt).toBeGreaterThanOrEqual(
        jobs[index].createdAt,
      );
    }
  });
});
