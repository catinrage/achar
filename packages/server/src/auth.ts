import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Optional bearer-token authentication.
 *
 * Tokens are compared as SHA-256 digests: `timingSafeEqual` requires equal
 * lengths, and hashing first keeps both the comparison and the token's length
 * out of the timing signal.
 */

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf-8').digest();
}

function tokenMatches(expected: string, presented: string): boolean {
  return timingSafeEqual(digest(expected), digest(presented));
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (!header) return undefined;

  const [scheme, ...rest] = header.split(' ');
  if (scheme.toLowerCase() !== 'bearer') return undefined;

  const token = rest.join(' ').trim();
  return token.length > 0 ? token : undefined;
}

export function isAuthorized(request: Request, expected: string): boolean {
  const presented = bearerToken(request);
  return presented !== undefined && tokenMatches(expected, presented);
}
