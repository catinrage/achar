/**
 * The value every route handler returns.
 *
 * Handlers hand back a serialized body rather than a `Response` so the router
 * can size it for the access log and attach shared headers in one place.
 * Binary bodies (a downloaded NC file, a ZIP of a whole job) travel as bytes
 * through the same path.
 */
export interface RouteResponse {
  status: number;
  /**
   * A `ReadableStream` is for bodies that must not be buffered — an uploaded
   * trace handed back for download runs to hundreds of megabytes.
   */
  body: string | Uint8Array | ReadableStream;
  contentType: string;
  headers?: Record<string, string>;
}

const JSON_TYPE = 'application/json; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';

export function json(value: unknown, status = 200): RouteResponse {
  return { status, body: JSON.stringify(value), contentType: JSON_TYPE };
}

export function plainText(value: string, status = 200): RouteResponse {
  return { status, body: value, contentType: TEXT_TYPE };
}

export function bytes(
  value: Uint8Array,
  contentType: string,
  headers?: Record<string, string>,
): RouteResponse {
  return { status: 200, body: value, contentType, headers };
}

/** Marks a response as a download rather than something to render inline. */
export function attachment(filename: string): Record<string, string> {
  // RFC 6266: the ASCII fallback keeps old clients working while `filename*`
  // carries the real name, which for a Persian machine or part may be
  // entirely non-ASCII.
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return {
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}

export function toResponse(result: RouteResponse): Response {
  return new Response(result.body as BodyInit, {
    status: result.status,
    headers: {
      'content-type': result.contentType,
      ...result.headers,
    },
  });
}

export function byteLength(
  value: string | Uint8Array | ReadableStream,
): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf-8');
  // A stream's size is unknown until it has been consumed, and consuming it to
  // measure it would defeat streaming. The access log reports 0 instead.
  return value instanceof ReadableStream ? 0 : value.byteLength;
}
