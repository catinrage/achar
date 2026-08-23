import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../errors';
import { spoolToFile } from './upload';

/**
 * The upload path is where a 311 MB body either stays out of memory or does
 * not, so these check the guarantees rather than the plumbing: the bytes land
 * intact, the hash matches, the cap holds even without a Content-Length, and a
 * rejected upload leaves nothing behind.
 */

let root: string;
let destination: string;

beforeEach(() => {
  root = path.join('/tmp', `achar-upload-spec-${Bun.randomUUIDv7()}`);
  destination = path.join(root, 'trace.MPF');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A request whose body arrives in chunks, as a real upload does. */
function chunkedRequest(chunks: string[], declaredLength?: number): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });

  const headers: Record<string, string> = {};
  if (declaredLength !== undefined) {
    headers['content-length'] = String(declaredLength);
  }

  return new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers,
    // @ts-expect-error duplex is required for a streamed body
    duplex: 'half',
    body: stream,
  });
}

async function expectRejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error('Expected the upload to be rejected.');
}

describe('spoolToFile', () => {
  it('writes the body to disk and reports its size and hash', async () => {
    const body = 'N10 G0 X0\nN20 G1 Z-5\n';
    const result = await spoolToFile(
      chunkedRequest([body]),
      destination,
      1024 * 1024,
    );

    expect(result.bytes).toBe(Buffer.byteLength(body, 'utf-8'));
    expect(await Bun.file(destination).text()).toBe(body);

    const expected = new Bun.CryptoHasher('sha256')
      .update(new TextEncoder().encode(body))
      .digest('hex');
    expect(result.sha256).toBe(expected);
  });

  it('reassembles a body split across chunks', async () => {
    const chunks = ['(0)@start', '_of_file\n', 'part_name : ', "'X'\n"];
    const result = await spoolToFile(
      chunkedRequest(chunks),
      destination,
      1024 * 1024,
    );

    expect(await Bun.file(destination).text()).toBe(chunks.join(''));
    expect(result.bytes).toBe(Buffer.byteLength(chunks.join(''), 'utf-8'));
  });

  it('hashes identical content to the same digest', async () => {
    const first = await spoolToFile(
      chunkedRequest(['same content']),
      destination,
      1024,
    );
    const second = await spoolToFile(
      chunkedRequest(['same', ' ', 'content']),
      path.join(root, 'other.MPF'),
      1024,
    );

    // Chunk boundaries must not affect the digest, or the cache would miss on
    // the same file uploaded over a different connection.
    expect(second.sha256).toBe(first.sha256);
  });

  it('rejects a declared length over the cap before reading anything', async () => {
    const error = await expectRejection(
      spoolToFile(chunkedRequest(['x'], 10_000), destination, 1024),
    );

    expect(error.status).toBe(413);
    expect(error.code).toBe('body-too-large');
    expect(await Bun.file(destination).exists()).toBe(false);
  });

  it('enforces the cap on a body that declares no length', async () => {
    // A chunked upload never states its size, so the running total is the
    // only bound it gets.
    const error = await expectRejection(
      spoolToFile(
        chunkedRequest(['a'.repeat(600), 'b'.repeat(600)]),
        destination,
        1000,
      ),
    );

    expect(error.status).toBe(413);
  });

  it('leaves no partial file behind when an upload is refused', async () => {
    await expectRejection(
      spoolToFile(chunkedRequest(['x'.repeat(4096)]), destination, 100),
    );

    expect(await Bun.file(destination).exists()).toBe(false);
  });

  it('rejects an empty body', async () => {
    const error = await expectRejection(
      spoolToFile(chunkedRequest([]), destination, 1024),
    );

    expect(error.status).toBe(400);
    expect(await Bun.file(destination).exists()).toBe(false);
  });
});
