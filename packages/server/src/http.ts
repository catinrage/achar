/**
 * The value every route handler returns.
 *
 * Handlers hand back a serialized body rather than a `Response` so the router
 * can size it for the access log and attach shared headers in one place.
 */
export interface RouteResponse {
  status: number;
  body: string;
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

export function toResponse(result: RouteResponse): Response {
  return new Response(result.body, {
    status: result.status,
    headers: {
      'content-type': result.contentType,
      ...result.headers,
    },
  });
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}
