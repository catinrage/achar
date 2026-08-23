import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { badRequest, bodyTooLarge } from '../errors';

/**
 * Streams an uploaded trace straight to the volume.
 *
 * The `/v1` routes buffer their body, which is affordable for an API client
 * posting one trace at a time. A shared queue is different: a browser upload
 * that sat in memory while it waited its turn would hold hundreds of megabytes
 * hostage for the whole queue, competing with the very parse it is queued
 * behind. So the bytes go to disk as they arrive and only the path is kept.
 *
 * The content hash is computed in the same pass. It costs nothing extra here
 * and is what makes a repeat upload resolvable to the earlier result instead
 * of a second fifteen-second parse.
 */

export interface SpooledUpload {
  path: string;
  bytes: number;
  sha256: string;
}

export async function spoolToFile(
  request: Request,
  destination: string,
  maxBytes: number,
): Promise<SpooledUpload> {
  assertDeclaredLength(request, maxBytes);

  const body = request.body;
  if (!body) throw badRequest('The request has no body to read a trace from.');

  await mkdir(path.dirname(destination), { recursive: true });

  const hasher = new Bun.CryptoHasher('sha256');
  const writer = Bun.file(destination).writer();
  const reader = body.getReader();
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      // Checked per chunk, not only against Content-Length: a chunked upload
      // declares no length at all, and this is the only bound it gets.
      if (bytes > maxBytes) throw bodyTooLarge(maxBytes);

      hasher.update(value);
      writer.write(value);
    }
    await writer.end();
  } catch (error) {
    // A partial spool is never useful and would otherwise sit on the volume
    // until the retention sweep, which only looks at jobs that exist.
    try {
      await writer.end();
    } catch {
      // Already closed by the failure; nothing to release.
    }
    await rm(destination, { force: true });
    throw error;
  }

  if (bytes === 0) {
    await rm(destination, { force: true });
    throw badRequest('The uploaded trace is empty.');
  }

  return { path: destination, bytes, sha256: hasher.digest('hex') };
}

/** Rejects an over-sized body from its declared length, before reading it. */
function assertDeclaredLength(request: Request, maxBytes: number): void {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw bodyTooLarge(maxBytes);
  }
}
