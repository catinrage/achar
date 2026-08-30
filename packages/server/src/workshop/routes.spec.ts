import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  TIMED_TRACE,
  TWO_SETUP_TRACE,
  UNTIMED_TRACE,
} from '@achar/server/fixtures.spec-helper';
import type { WorkshopServer } from './workshop';
import { startWorkshopServer } from './workshop';

/**
 * End-to-end coverage of the browser-facing service: upload, analysis, queue,
 * results, downloads and the content-hash cache.
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

/** Uploads a trace the way the browser does: raw body, name in the query. */
function uploadTrace(trace: string, filename = 'test.MPF'): Promise<Response> {
  return fetch(`${base}/api/traces?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: trace,
  });
}

/** Polls until the analysis settles, as the UI does. */
async function analyzed(sha: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { trace } = await (await fetch(`${base}/api/traces/${sha}`)).json();
    if (trace.status !== 'analyzing') return trace;
    await Bun.sleep(25);
  }
  throw new Error('The trace was never analysed.');
}

/** Uploads, waits for the analysis, and returns the trace view. */
async function analyze(trace: string, filename = 'test.MPF') {
  const response = await uploadTrace(trace, filename);
  const body = await response.json();
  return { ...(await analyzed(body.trace.sha256)), cached: body.cached };
}

interface JobRequest {
  machineId?: string;
  programName?: string;
  setups?: string;
  keepAllTools?: boolean;
}

/** Queues generation for an already-analysed trace. */
function submit(sha: string, options: JobRequest = {}): Promise<Response> {
  const query = new URLSearchParams({
    traceSha: sha,
    machineId: options.machineId ?? machineId,
  });
  if (options.programName) query.set('programName', options.programName);
  if (options.setups) query.set('setups', options.setups);
  if (options.keepAllTools) query.set('keepAllTools', 'true');

  return fetch(`${base}/api/jobs?${query}`, { method: 'POST' });
}

/** The whole flow an operator walks through, for tests that only want output. */
async function generate(
  trace: string,
  options: JobRequest & { filename?: string } = {},
) {
  const analysis = await analyze(trace, options.filename ?? 'test.MPF');
  const response = await submit(analysis.sha256, options);
  const body = await response.json();
  return { response, ...body };
}

/** Polls until the job leaves the queue, as the UI does. */
async function settle(jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${base}/api/jobs/${jobId}`);
    const { job } = await response.json();
    if (job.status === 'done' || job.status === 'failed') return job;
    await Bun.sleep(25);
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
      profile: null,
    });
  });

  it('serves the post list the machine form needs', async () => {
    const { posts } = await (await fetch(`${base}/api/posts`)).json();
    expect(posts).toContainEqual({
      id: 'siemens-828d',
      name: 'Siemens 828D Milling 4A',
      controller: 'siemens-828d',
      dialects: ['Siemens_828D_Milling_4A', 'Siemens_828D_Milling_3A'],
    });
  });

  it('serves the machine feature schema the form renders inputs from', async () => {
    const { machineFeatures } = await (await fetch(`${base}/api/posts`)).json();

    expect(machineFeatures).toContainEqual({
      key: 'maxSpindleSpeed',
      kind: 'number',
      label: 'Maximum spindle speed',
      min: 1,
      integer: true,
      unit: 'rpm',
      description:
        'Fastest the spindle can turn. A program commanding more is refused rather than posted.',
    });
    expect(
      machineFeatures.find(
        (spec: { key: string }) => spec.key === 'toolChanger',
      ),
    ).toMatchObject({
      kind: 'enum',
      values: ['carousel', 'umbrella', 'manual'],
    });
  });
});

describe('POST /api/traces', () => {
  it('accepts an upload and analyses it without a machine', async () => {
    // Analysis is what the operator reads *before* choosing anything, so it
    // must not need a machine, a post, or a VMID.
    const trace = await analyze(TWO_SETUP_TRACE, 'two-setups.MPF');

    expect(trace.status).toBe('ready');
    expect(trace.name).toBe('two-setups.MPF');
    expect(trace.setups).toHaveLength(2);
    expect(trace.setups[0]).toMatchObject({
      index: 1,
      name: 'Front',
      fixtureName: 'Vise',
      jobCount: 1,
      duration: '0:02:00',
    });
    expect(trace.timing.duration).toMatch(/^\d+:\d{2}:\d{2}$/);
    expect(trace.profile.tools.length).toBeGreaterThan(0);
  });

  it('answers a repeat upload from the stored analysis', async () => {
    const first = await analyze(TIMED_TRACE, 'repeat.MPF');
    const response = await uploadTrace(TIMED_TRACE, 'repeat.MPF');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cached).toBe(true);
    expect(body.trace.sha256).toBe(first.sha256);
    expect(body.trace.status).toBe('ready');
  });

  it('reports a file that is not a trace as a failed analysis', async () => {
    const trace = await analyze('this is not a trace', 'garbage.MPF');

    expect(trace.status).toBe('failed');
    expect(trace.error).toContain('Trace 5');
  });

  it('rejects an empty upload', async () => {
    expect((await uploadTrace('', 'empty.MPF')).status).toBe(400);
  });

  it('surfaces a trace-level diagnostic before any machine is chosen', async () => {
    const trace = await analyze(UNTIMED_TRACE, 'untimed-analysis.MPF');

    expect(trace.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'no-timing-data' }),
    );
  });
});

describe('POST /api/jobs', () => {
  it('queues generation for an analysed trace', async () => {
    const { response, job, cached } = await generate(TIMED_TRACE, {
      filename: 'queued.MPF',
    });

    expect(response.status).toBe(202);
    expect(cached).toBe(false);
    expect(job.status).toBe('queued');
    expect(job.position).toBe(1);
    expect(job.traceName).toBe('queued.MPF');
    expect(job.traceBytes).toBe(Buffer.byteLength(TIMED_TRACE, 'utf-8'));
    expect(job.setups).toBeNull();
  });

  it('produces G-code, cycle time and a tool list from one upload', async () => {
    const { job } = await generate(TIMED_TRACE, { filename: 'complete.MPF' });
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
    const { job } = await generate(TIMED_TRACE, {
      filename: 'named.MPF',
      programName: 'CUSTOM_NAME',
    });
    const settled = await settle(job.id);

    expect(settled.programName).toBe('CUSTOM_NAME');
    expect(
      settled.files.some((file: { name: string }) =>
        file.name.startsWith('CUSTOM_NAME'),
      ),
    ).toBe(true);
  });

  it('rejects an unknown machine', async () => {
    const { response } = await generate(TIMED_TRACE, {
      machineId: 'no-such-machine',
      filename: 'unknown-machine.MPF',
    });

    expect(response.status).toBe(400);
  });

  it('rejects an unknown trace', async () => {
    const response = await submit('0'.repeat(64));

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain('Unknown trace');
  });

  it('records a trace refused on content as done-but-blocked', async () => {
    // An untimed trace parses and yields diagnostics rather than G-code. It is
    // a finished job, not a failed one: the operator still gets the reason,
    // plus whatever could be extracted anyway.
    const { job } = await generate(UNTIMED_TRACE, { filename: 'untimed.MPF' });
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

describe('setup selection', () => {
  it('posts only the selected setup, with only the tools it loads', async () => {
    const whole = await generate(TWO_SETUP_TRACE, {
      filename: 'whole.MPF',
      programName: 'WHOLE',
    });
    const wholeSettled = await settle(whole.job.id);

    const narrowed = await generate(TWO_SETUP_TRACE, {
      filename: 'whole.MPF',
      programName: 'NARROW',
      setups: '2',
    });
    const settled = await settle(narrowed.job.id);

    expect(settled.status).toBe('done');
    expect(settled.setups).toEqual([2]);
    expect(settled.selectedSetups).toEqual([
      expect.objectContaining({ index: 2, name: 'Back' }),
    ]);

    // The narrowed program runs one setup's work, so it is shorter than the
    // whole part and its tool table no longer mentions the other setup's tool.
    const code = await readAll(settled);
    expect(code).not.toContain('END12Z3AL');
    expect(code).toContain('DRILL6');
    expect(settled.timing.seconds).toBeLessThan(wholeSettled.timing.seconds);
  });

  it('keeps the full tool table when asked', async () => {
    const { job } = await generate(TWO_SETUP_TRACE, {
      filename: 'keep-tools.MPF',
      programName: 'KEEPALL',
      setups: '2',
      keepAllTools: true,
    });
    const settled = await settle(job.id);

    expect(await readAll(settled)).toContain('END12Z3AL');
  });

  it('warns that a setup posted without its predecessor starts from defaults', async () => {
    const { job } = await generate(TWO_SETUP_TRACE, {
      filename: 'warned.MPF',
      programName: 'WARNED',
      setups: '2',
    });
    const settled = await settle(job.id);

    expect(settled.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('without setup 1'),
      }),
    );
  });

  it('treats selecting every setup as the whole part', async () => {
    // Ticking all the boxes must produce the same job — and the same bytes —
    // as ticking none, or the default path would depend on how the operator
    // happened to phrase "everything".
    const whole = await generate(TWO_SETUP_TRACE, {
      filename: 'all.MPF',
      programName: 'ALL',
    });
    await settle(whole.job.id);

    const analysis = await analyze(TWO_SETUP_TRACE, 'all.MPF');
    const response = await submit(analysis.sha256, {
      programName: 'ALL',
      setups: '1,2',
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cached).toBe(true);
    expect(body.job.id).toBe(whole.job.id);
  });

  it('refuses a setup the trace does not have', async () => {
    const analysis = await analyze(TWO_SETUP_TRACE, 'range.MPF');
    const response = await submit(analysis.sha256, { setups: '5' });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain('no setup 5');
  });

  it('refuses a selection that is not an index', async () => {
    // Names and ranges are a CLI convenience; over HTTP the UI sends back the
    // indices the analysis reported, so anything else is a mistake.
    const analysis = await analyze(TWO_SETUP_TRACE, 'named-selection.MPF');
    const response = await submit(analysis.sha256, { setups: 'Front' });

    expect(response.status).toBe(400);
  });
});

describe('the content-hash cache', () => {
  it('returns the earlier job for an identical trace and machine', async () => {
    const first = await generate(TIMED_TRACE, { filename: 'cache-me.MPF' });
    await settle(first.job.id);

    const { response, job, cached } = await generate(TIMED_TRACE, {
      filename: 'cache-me.MPF',
    });

    expect(response.status).toBe(200);
    expect(cached).toBe(true);
    expect(job.id).toBe(first.job.id);
    expect(job.status).toBe('done');
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

    const { response, cached } = await generate(TIMED_TRACE, {
      machineId: other,
      filename: 'cache-me.MPF',
    });

    expect(response.status).toBe(202);
    expect(cached).toBe(false);
  });

  it('does not reuse a whole-part job for a narrowed one', async () => {
    const whole = await generate(TWO_SETUP_TRACE, {
      filename: 'cache-setups.MPF',
      programName: 'CACHESETUPS',
    });
    await settle(whole.job.id);

    const { response, job } = await generate(TWO_SETUP_TRACE, {
      filename: 'cache-setups.MPF',
      programName: 'CACHESETUPS',
      setups: '1',
    });

    expect(response.status).toBe(202);
    expect(job.id).not.toBe(whole.job.id);
  });
});

/** Every generated file of a finished job, concatenated. */
async function readAll(job: {
  id: string;
  files: Array<{ name: string }>;
}): Promise<string> {
  const parts: string[] = [];
  for (const file of job.files) {
    const response = await fetch(
      `${base}/api/jobs/${job.id}/files/${encodeURIComponent(file.name)}`,
    );
    parts.push(await response.text());
  }
  return parts.join('\n');
}

describe('downloads', () => {
  it('serves a single generated file as an attachment', async () => {
    const { job } = await generate(TIMED_TRACE, {
      filename: 'download.MPF',
      programName: 'DL',
    });
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
    const { job } = await generate(TIMED_TRACE, {
      filename: 'zip.MPF',
      programName: 'ZIPPED',
    });
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
    const { job } = await generate(TIMED_TRACE, {
      filename: 'guard.MPF',
      programName: 'GUARD',
    });
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

describe('DELETE /api/jobs/:id', () => {
  /**
   * Forces a job's status through a second connection.
   *
   * The guard being tested only fires while the queue still owns the job, and
   * a real one settles in milliseconds — racing it would make the test flaky
   * about the exact thing it is checking. Writing the state directly is the
   * deterministic way to ask "what does the route do with a running job?".
   */
  function forceStatus(jobId: string, status: string): void {
    const db = new Database(path.join(dataDir, 'achar.sqlite'));
    try {
      db.query('UPDATE jobs SET status = ? WHERE id = ?').run(status, jobId);
    } finally {
      db.close();
    }
  }

  it('removes the row, its files and its output directory', async () => {
    const { job } = await generate(TIMED_TRACE, {
      filename: 'delete-me.MPF',
      programName: 'DELETEME',
    });
    const settled = await settle(job.id);
    expect(settled.files.length).toBeGreaterThan(0);

    const directory = path.join(dataDir, 'jobs', job.id);
    expect(existsSync(directory)).toBe(true);

    const response = await fetch(`${base}/api/jobs/${job.id}`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(job.id);
    expect((await fetch(`${base}/api/jobs/${job.id}`)).status).toBe(404);
    expect(existsSync(directory)).toBe(false);

    const { jobs } = await (await fetch(`${base}/api/jobs?limit=100`)).json();
    expect(jobs.map((entry: { id: string }) => entry.id)).not.toContain(job.id);
  });

  it('leaves the uploaded trace alone', async () => {
    // The trace is content-addressed and shared by every job posted from it,
    // so forgetting one job must not take another job's input with it.
    const analysis = await analyze(TIMED_TRACE, 'shared.MPF');
    const first = await (
      await submit(analysis.sha256, {
        programName: 'FIRST',
      })
    ).json();
    await settle(first.job.id);

    await fetch(`${base}/api/jobs/${first.job.id}`, { method: 'DELETE' });

    expect((await fetch(`${base}/api/traces/${analysis.sha256}`)).status).toBe(
      200,
    );
    const again = await submit(analysis.sha256, { programName: 'SECOND' });
    expect(again.status).toBe(202);
  });

  it('refuses a job the queue still owns', async () => {
    const { job } = await generate(TIMED_TRACE, {
      filename: 'busy.MPF',
      programName: 'BUSY',
    });
    await settle(job.id);
    forceStatus(job.id, 'running');

    const response = await fetch(`${base}/api/jobs/${job.id}`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain('not finished');
    // Still there, because a worker may still be about to write into it.
    expect((await fetch(`${base}/api/jobs/${job.id}`)).status).toBe(200);
  });

  it('404s an unknown job', async () => {
    const response = await fetch(`${base}/api/jobs/does-not-exist`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(404);
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
