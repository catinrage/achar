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
export interface TaskDocuments {
  vmid?: string;
  machineProfile?: string;
}

export interface TaskOptions {
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
   * The browser-facing job: everything the results page needs, from one parse.
   * Output is written to `outDir` by the worker rather than returned, so a
   * multi-megabyte G-code set never crosses the thread boundary.
   */
  | ({ op: 'job'; outDir: string } & BaseTask);

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

/** What the `job` op reports back once output is on disk. */
export interface JobOutcome {
  files: Array<{ name: string; bytes: number; lines: number }>;
  diagnostics: unknown;
  timing: unknown;
  profile: unknown;
  programName: string;
  eventCount: number;
  /** Set when error-severity diagnostics stopped generation. */
  blocked: boolean;
}
