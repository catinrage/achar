import type { GeneratedFile } from '@achar/core';
import { badRequest, bodyTooLarge } from './errors';

/**
 * Request decoding for the two accepted input shapes.
 *
 * **Raw body** — `text/plain`, `application/octet-stream`, or no content type
 * at all. The whole body is the endpoint's primary document (a trace, a VMID,
 * a post source) and every option comes from the query string. This is the
 * fast path.
 *
 * **Multipart** — named parts (`trace`, `vmid`, `machineProfile`, and a
 * repeatable `reference`), with non-file text fields carrying the same options
 * the query string would. The query string wins on conflict, so a caller can
 * override a stored form field without rebuilding the body.
 *
 * Bun's `formData()` buffers every part in memory; the `Content-Length` check
 * here and the concurrency gate in the router are what keep that affordable.
 */

const MULTIPART = 'multipart/form-data';

export class RequestBody {
  private readonly raw: string | undefined;
  private readonly fields: Map<string, string>;
  private readonly files: Map<string, GeneratedFile[]>;
  private readonly query: URLSearchParams;

  constructor(init: {
    raw?: string;
    fields: Map<string, string>;
    files: Map<string, GeneratedFile[]>;
    query: URLSearchParams;
  }) {
    this.raw = init.raw;
    this.fields = init.fields;
    this.files = init.files;
    this.query = init.query;
  }

  /**
   * The endpoint's main document: the named multipart part when the request
   * was multipart, otherwise the raw body.
   */
  document(name: string): string {
    const value = this.optionalDocument(name);
    if (value === undefined || value.trim().length === 0) {
      throw badRequest(
        `A '${name}' is required, as a multipart part named '${name}' or as the raw request body.`,
      );
    }
    return value;
  }

  optionalDocument(name: string): string | undefined {
    return this.files.get(name)?.[0]?.code ?? this.fields.get(name) ?? this.raw;
  }

  /** A supporting part. Never falls back to the raw body. */
  part(name: string): string | undefined {
    const value = this.files.get(name)?.[0]?.code ?? this.fields.get(name);
    return value !== undefined && value.trim().length > 0 ? value : undefined;
  }

  /** All parts uploaded under a repeatable name, keyed by their filename. */
  fileList(name: string): GeneratedFile[] {
    return this.files.get(name) ?? [];
  }

  /** Query string first, then a same-named multipart text field. */
  option(name: string): string | undefined {
    const value = this.query.get(name) ?? this.fields.get(name);
    return value !== null && value !== undefined && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  /** A bounded integer option, rejecting anything unparseable. */
  integerOption(
    name: string,
    bounds: { fallback: number; min: number; max: number },
  ): number {
    const raw = this.option(name);
    if (raw === undefined) return bounds.fallback;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < bounds.min) {
      throw badRequest(
        `'${name}' must be an integer of at least ${bounds.min}; received '${raw}'.`,
      );
    }
    return Math.min(parsed, bounds.max);
  }
}

/** Rejects an over-sized body from its declared length, before buffering it. */
export function assertDeclaredLength(
  request: Request,
  maxBodyBytes: number,
): void {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    throw bodyTooLarge(maxBodyBytes);
  }
}

export async function readRequestBody(
  request: Request,
  url: URL,
  maxBodyBytes: number,
): Promise<RequestBody> {
  assertDeclaredLength(request, maxBodyBytes);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes(MULTIPART)) {
    return new RequestBody({
      raw: await request.text(),
      fields: new Map(),
      files: new Map(),
      query: url.searchParams,
    });
  }

  const form = await readFormData(request);
  const fields = new Map<string, string>();
  const files = new Map<string, GeneratedFile[]>();

  // Typed explicitly: a form entry is either a text field or an uploaded file,
  // and the ambient FormData typing does not carry the file arm.
  const entries = [...form.entries()] as Array<[string, string | File]>;

  for (const [name, value] of entries) {
    if (typeof value === 'string') {
      if (!fields.has(name)) fields.set(name, value);
      continue;
    }
    const existing = files.get(name) ?? [];
    existing.push({ file: value.name, code: await value.text() });
    files.set(name, existing);
  }

  return new RequestBody({ fields, files, query: url.searchParams });
}

async function readFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw badRequest('The multipart/form-data body could not be decoded.');
  }
}
