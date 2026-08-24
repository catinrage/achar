import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  CONTRADICTORY_REPEAT_TRACE,
  TIMED_TRACE,
  UNTIMED_TRACE,
} from './fixtures.spec-helper';
import type { AcharServer } from './server';
import { startAcharServer } from './server';

const TOKEN = 'test-token';

let server: AcharServer;
let base: string;
/** Scratch space. Given explicitly so a test run leaves nothing behind. */
let scratchDir: string;

beforeAll(async () => {
  scratchDir = path.join('/tmp', `achar-server-spec-${Bun.randomUUIDv7()}`);
  server = await startAcharServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    // Small enough to exercise the 413 path without allocating a real trace.
    maxBodyBytes: 64 * 1024,
    scratchDir,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.stop();
  for (const directory of [scratchDir, ...extraScratchDirs]) {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Throwaway scratch for a server started inside one test. */
function temporaryScratchDir(): string {
  const directory = path.join(
    '/tmp',
    `achar-server-spec-${Bun.randomUUIDv7()}`,
  );
  extraScratchDirs.push(directory);
  return directory;
}

const extraScratchDirs: string[] = [];

/** POSTs a raw trace body with the configured bearer token. */
function postTrace(
  path: string,
  body: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers as Record<string, string>),
    },
    body,
    ...init,
  });
}

describe('GET /health', () => {
  it('reports status without a token', async () => {
    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('ok');
    expect(typeof payload.version).toBe('string');
    expect(payload.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /v1/posts', () => {
  it('lists the built-in posts', async () => {
    const response = await fetch(`${base}/v1/posts`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.status).toBe(200);
    const { posts } = await response.json();
    expect(posts).toContainEqual({
      id: 'siemens-828d',
      name: 'Siemens 828D Milling 4A',
      aliases: ['default'],
      dialects: ['siemens-828d', 'poyakar-1160l'],
    });
  });
});

describe('POST /v1/trace/profile', () => {
  it('returns the product profile for a healthy trace', async () => {
    const response = await postTrace('/v1/trace/profile', TIMED_TRACE);

    expect(response.status).toBe(200);
    const profile = await response.json();
    expect(profile.part.name).toBe('DEMO_PART');
    expect(profile.part.materialName).toBe('Aluminum_120BHN-69HRB');
    expect(profile.setups).toHaveLength(1);
    expect(profile.setups[0].fixtureName).toBe('Vise');
    expect(profile.setups[0].duration).toBe('0:02:00');
    expect(profile.setups[0].tools[0].tool).toBe('END12Z3AL');
    expect(profile.totals.duration).toBe('0:02:00');
    expect(profile.diagnostics).toEqual([]);
    expect(profile.events).toBeUndefined();
  });

  it('returns 422 with the profile when the trace has no timing', async () => {
    const response = await postTrace('/v1/trace/profile', UNTIMED_TRACE);

    expect(response.status).toBe(422);
    // The body is still the full profile so the caller can show what it got.
    const profile = await response.json();
    expect(profile.part.name).toBe('UNTIMED_PART');
    expect(profile.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'no-timing-data' }),
    );
  });

  it('returns 422 when the trace contradicts itself on job time', async () => {
    const response = await postTrace(
      '/v1/trace/profile',
      CONTRADICTORY_REPEAT_TRACE,
    );

    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe('unprocessable');
  });
});

describe('POST /v1/trace/timing', () => {
  it('returns the timing report', async () => {
    const response = await postTrace('/v1/trace/timing', TIMED_TRACE);

    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.duration).toBe('0:02:00');
    expect(report.setups[0].jobs[0].name).toBe('iRough');
  });

  it('returns 422 when repeats of one job disagree on their time', async () => {
    const response = await postTrace(
      '/v1/trace/timing',
      CONTRADICTORY_REPEAT_TRACE,
    );

    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe('unprocessable');
    // The caller gets the real reason, not a generic 500.
    expect(error.message).toContain('DRILL6D');
  });
});

describe('POST /v1/trace/generate', () => {
  it('generates G-code inline', async () => {
    const response = await postTrace(
      '/v1/trace/generate?programName=DEMO_PART',
      TIMED_TRACE,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.eventCount).toBe(9);

    const names = payload.files.map((file: { file: string }) => file.file);
    expect(names).toEqual([
      'DEMO_PART.MPF',
      'Tools_Length_Measurement.MPF',
      'iRough.SPF',
    ]);

    const main = payload.files[0];
    expect(main.code).toContain('EXTCALL "iRough.SPF"');
    expect(main.bytes).toBeGreaterThan(0);
    expect(main.lines).toBeGreaterThan(1);

    const sub = payload.files[2];
    expect(sub.code).toContain('T="END12Z3AL" M6');
    expect(sub.code).toContain('G1 G94 X30 Z-2 F500');
  });

  it('names the program from the trace when the option is absent', async () => {
    const response = await postTrace('/v1/trace/generate', TIMED_TRACE);
    const payload = await response.json();

    expect(payload.files[0].file).toBe('DEMO_PART.MPF');
  });

  it('rejects an unknown post id', async () => {
    const response = await postTrace(
      '/v1/trace/generate?postId=haas-ngc',
      TIMED_TRACE,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('bad-request');
  });
});

describe('POST /v1/trace/explain', () => {
  it('returns a plain-text explanation', async () => {
    const response = await postTrace('/v1/trace/explain', TIMED_TRACE);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect((await response.text()).length).toBeGreaterThan(0);
  });
});

describe('POST /v1/trace/parse', () => {
  it('paginates events and reports the total', async () => {
    const response = await postTrace(
      '/v1/trace/parse?limit=2&offset=1',
      TIMED_TRACE,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.total).toBe(9);
    expect(payload.offset).toBe(1);
    expect(payload.limit).toBe(2);
    expect(payload.events).toHaveLength(2);
    expect(payload.events[0]._eventName).toBe('Setup');
  });

  it('clamps limit to the hard maximum instead of failing', async () => {
    const response = await postTrace(
      '/v1/trace/parse?limit=999999',
      TIMED_TRACE,
    );

    expect((await response.json()).limit).toBe(5000);
  });

  it('filters by event name', async () => {
    const response = await postTrace(
      '/v1/trace/parse?event=DefTool',
      TIMED_TRACE,
    );
    const payload = await response.json();

    expect(payload.total).toBe(1);
    expect(payload.events[0].tool_id_string).toBe('END12Z3AL');
  });

  it('rejects a non-numeric limit', async () => {
    const response = await postTrace('/v1/trace/parse?limit=lots', TIMED_TRACE);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('bad-request');
  });
});

describe('POST /v1/trace/parity', () => {
  it('compares generated output against uploaded reference files', async () => {
    const generated = await (
      await postTrace('/v1/trace/generate?programName=DEMO_PART', TIMED_TRACE)
    ).json();

    const form = new FormData();
    form.append('trace', new File([TIMED_TRACE], 'trace.MPF'));
    form.append('programName', 'DEMO_PART');
    for (const file of generated.files) {
      form.append('reference', new File([file.code], file.file));
    }

    const response = await fetch(`${base}/v1/trace/parity`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: form,
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.summary).toEqual({
      match: 3,
      different: 0,
      missingGenerated: 0,
      missingReference: 0,
    });
  });

  it('reports a difference when the reference disagrees', async () => {
    const form = new FormData();
    form.append('trace', new File([TIMED_TRACE], 'trace.MPF'));
    form.append('programName', 'DEMO_PART');
    form.append('reference', new File(['N10 WRONG'], 'DEMO_PART.MPF'));

    const response = await fetch(`${base}/v1/trace/parity`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: form,
    });

    const payload = await response.json();
    expect(payload.summary.different).toBe(1);
  });

  it('requires at least one reference part', async () => {
    const response = await postTrace('/v1/trace/parity', TIMED_TRACE);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('bad-request');
  });
});

describe('POST /v1/post/lint', () => {
  it('reports lint issues in a post source', async () => {
    const response = await postTrace(
      '/v1/post/lint',
      "post.on('StartOfFile', ($) => { $.put('G0'); });",
    );

    expect(response.status).toBe(200);
    const { issues } = await response.json();
    expect(issues).toContainEqual(
      expect.objectContaining({ rule: 'no-raw-put', line: 1 }),
    );
  });
});

describe('multipart input', () => {
  it('accepts the trace as a named part with form-field options', async () => {
    const form = new FormData();
    form.append('trace', new File([TIMED_TRACE], 'demo.MPF'));
    form.append('programName', 'FROM_FORM');

    const response = await fetch(`${base}/v1/trace/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: form,
    });

    const payload = await response.json();
    expect(payload.files[0].file).toBe('FROM_FORM.MPF');
  });

  it('lets the query string win over a form field', async () => {
    const form = new FormData();
    form.append('trace', new File([TIMED_TRACE], 'demo.MPF'));
    form.append('programName', 'FROM_FORM');

    const response = await fetch(
      `${base}/v1/trace/generate?programName=FROM_QUERY`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: form,
      },
    );

    const payload = await response.json();
    expect(payload.files[0].file).toBe('FROM_QUERY.MPF');
  });
});

describe('errors', () => {
  it('rejects a missing token with 401', async () => {
    const response = await fetch(`${base}/v1/posts`);

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('unauthorized');
  });

  it('rejects a wrong token with 401', async () => {
    const response = await fetch(`${base}/v1/posts`, {
      headers: { authorization: 'Bearer not-the-token' },
    });

    expect(response.status).toBe(401);
  });

  it('rejects an oversized body with 413 before reading it', async () => {
    const response = await postTrace(
      '/v1/trace/profile',
      'x'.repeat(64 * 1024 + 1),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('body-too-large');
  });

  it('rejects a garbage body with 400', async () => {
    const response = await postTrace('/v1/trace/profile', 'not a trace at all');

    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(['parse-failed', 'bad-request']).toContain(error.code);
  });

  it('rejects an empty body with 400', async () => {
    const response = await postTrace('/v1/trace/profile', '');

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('bad-request');
  });

  it('rejects a pathologically long line instead of parsing it', async () => {
    // Real SolidCAM lines top out under 900 bytes, so a 16 KB line is not
    // Trace 5 output and is refused at the boundary. The parser no longer
    // cares — it is linear in line length — but the cap still says no.
    const response = await postTrace(
      '/v1/trace/profile',
      `${TIMED_TRACE}\n${'x'.repeat(16 * 1024)}`,
    );

    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error.code).toBe('bad-request');
    expect(error.message).toContain('exceeds');
  });

  it('returns 404 for an unknown route', async () => {
    const response = await fetch(`${base}/v1/nope`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('not-found');
  });

  it('returns 405 for a known route with the wrong method', async () => {
    const response = await fetch(`${base}/v1/trace/profile`, {
      method: 'GET',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe('method-not-allowed');
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('never leaks a filesystem path in an error message', async () => {
    const response = await postTrace('/v1/trace/profile', 'garbage');
    const { error } = await response.json();

    expect(error.message).not.toContain('/home/');
    expect(error.message).not.toContain('packages/');
  });
});

describe('without a token', () => {
  it('serves /v1 routes unauthenticated', async () => {
    const open = await startAcharServer({
      port: 0,
      host: '127.0.0.1',
      scratchDir: temporaryScratchDir(),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${open.port}/v1/posts`);
      expect(response.status).toBe(200);
    } finally {
      await open.stop();
    }
  });
});

describe('concurrency gate', () => {
  it('refuses overlapping parses with 503 and Retry-After', async () => {
    const gated = await startAcharServer({
      port: 0,
      host: '127.0.0.1',
      maxConcurrentParses: 1,
      scratchDir: temporaryScratchDir(),
    });

    try {
      // Padded so reading the body actually suspends; a 1 KB trace parses
      // inside one tick and never overlaps. Semaphore.spec.ts covers the
      // gate's own accounting deterministically. The padding must be many
      // short lines, not one long one: parse cost scales with the number of
      // lines, so one 4 MB line is a single cheap line and would not suspend.
      const padded = `${TIMED_TRACE}\n${'; pad\n'.repeat(400_000)}`;
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          fetch(`http://127.0.0.1:${gated.port}/v1/trace/profile`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: padded,
          }),
        ),
      );

      const rejected = responses.filter((response) => response.status === 503);
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected[0].headers.get('retry-after')).toBe('5');
      expect((await rejected[0].json()).error.code).toBe('busy');

      // Whatever was not refused must have been served, never queued.
      for (const response of responses) {
        expect([200, 503]).toContain(response.status);
      }
    } finally {
      await gated.stop();
    }
  });
});
