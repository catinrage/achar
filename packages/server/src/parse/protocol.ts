import type { CompareOptions, GeneratedFile } from '@achar/core';

/**
 * Message contract between the HTTP thread and a parse worker.
 *
 * Traces cross this boundary as **file paths**, never as strings. A 311 MB
 * trace structured-cloned into a worker would be copied in full before any
 * work started; handing over a path costs nothing and lets the worker read it
 * with the same streaming primitives the upload used.
 */

/** Documents supplied as content rather than paths. These are all small. */
interface TaskDocuments {
  vmid?: string;
  machineProfile?: string;
}

interface TaskOptions {
  postId?: string;
  programName?: string;
}

interface BaseTask extends TaskDocuments, TaskOptions {
  tracePath: string;
}

export type WorkerTask =
  | ({ op: 'profile' } & BaseTask)
  | ({ op: 'timing' } & BaseTask)
  | ({ op: 'validate' } & BaseTask)
  | ({ op: 'generate' } & BaseTask)
  | ({ op: 'explain'; file?: string; event?: string } & BaseTask)
  | ({
      op: 'parity';
      reference: GeneratedFile[];
      compare: CompareOptions;
    } & BaseTask)
  | ({ op: 'parse'; event?: string; offset: number; limit: number } & BaseTask)
  /**
   * Generate, timing and product profile from a single parse.
   *
   * The parse is ~97% of the cost, so the two extra extractions add well under
   * a second to a job measured in tens. Callers that need all three — the
   * workshop's results page does — would otherwise pay for three parses.
   */
  | ({ op: 'bundle' } & BaseTask);

/**
 * A failure the caller is responsible for, carried across the boundary.
 *
 * `HttpError` cannot survive a structured clone as itself, so its status and
 * code travel as data and the pool rebuilds the error on the other side.
 */
export interface TaskFailure {
  status: number;
  code: string;
  message: string;
}

export type WorkerResponse =
  | { ok: true; value: unknown; durationMs: number }
  | { ok: false; failure: TaskFailure };

/** A generated file, returned rather than written. */
export interface BundledFile {
  name: string;
  code: string;
  bytes: number;
  lines: number;
}

/**
 * What the `bundle` op reports back.
 *
 * Files come back as data so the worker touches nothing but the trace it was
 * given to read. Deciding where output belongs — and whether it is kept at all
 * — is the caller's business, not the parser's.
 */
export interface BundleOutcome {
  files: BundledFile[];
  diagnostics: unknown;
  timing: unknown;
  profile: unknown;
  programName: string;
  eventCount: number;
  /** Set when error-severity diagnostics stopped generation. */
  blocked: boolean;
}
