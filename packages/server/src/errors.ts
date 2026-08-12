/**
 * Error vocabulary for the HTTP surface.
 *
 * Every failure leaves the server as `{ error: { code, message } }`. `code` is
 * a stable identifier callers branch on; `message` is prose for a human and
 * may change. Messages are scrubbed of filesystem paths, and unexpected
 * failures never carry their original text off the box at all — see
 * {@link internalError}.
 */

export type ErrorCode =
  | 'bad-request'
  | 'parse-failed'
  | 'unauthorized'
  | 'not-found'
  | 'method-not-allowed'
  | 'body-too-large'
  | 'unprocessable'
  | 'busy'
  | 'internal';

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export const badRequest = (message: string): HttpError =>
  new HttpError(400, 'bad-request', message);

export const unauthorized = (): HttpError =>
  new HttpError(401, 'unauthorized', 'A valid bearer token is required.');

export const notFound = (): HttpError =>
  new HttpError(404, 'not-found', 'Unknown route.');

export const methodNotAllowed = (allowed: string[]): HttpError =>
  new HttpError(
    405,
    'method-not-allowed',
    `This route accepts ${allowed.join(', ')}.`,
    { Allow: allowed.join(', ') },
  );

export const bodyTooLarge = (limit: number): HttpError =>
  new HttpError(
    413,
    'body-too-large',
    `Request body exceeds the ${limit} byte limit.`,
  );

export const busy = (retryAfterSeconds: number): HttpError =>
  new HttpError(
    503,
    'busy',
    'All trace-parsing slots are in use. Retry shortly.',
    { 'Retry-After': String(retryAfterSeconds) },
  );

export const internalError = (): HttpError =>
  new HttpError(500, 'internal', 'An unexpected error occurred.');

/**
 * Wraps a parser failure. The parser reads from a string supplied by the
 * caller, so its message can only describe the caller's own content — but it
 * is scrubbed anyway in case a future code path folds in a path.
 */
export const parseFailed = (error: unknown): HttpError =>
  new HttpError(
    400,
    'parse-failed',
    `The trace could not be parsed: ${scrub(messageOf(error))}`,
  );

/**
 * Wraps a core `ValidationError` raised while analyzing an otherwise
 * well-formed trace — the syntax parsed, but its content contradicts itself
 * (see `extractTimingReport` on repeated job names). That is the caller's
 * document, not a server fault, so the real message goes back scrubbed rather
 * than collapsing into a generic 500.
 */
export const unprocessableTrace = (error: unknown): HttpError =>
  new HttpError(
    422,
    'unprocessable',
    `The trace could not be analyzed: ${scrub(messageOf(error))}`,
  );

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const POSIX_PATH = /(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]*/g;
const WINDOWS_PATH = /[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']*/g;

/** Replaces anything shaped like a filesystem path with a placeholder. */
function scrub(message: string): string {
  return message
    .replaceAll(POSIX_PATH, ' <path>')
    .replaceAll(WINDOWS_PATH, '<path>')
    .slice(0, 500);
}
