import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * On-disk layout for the workshop service.
 *
 * The `/v1` API is stateless by design and stays that way. Everything here
 * belongs to the browser-facing job queue, which cannot be stateless: an
 * upload has to survive long enough to be parsed by a worker, and an operator
 * has to be able to come back for the output.
 *
 * The root is a mounted volume in production. It defaults to a directory
 * beside the repo in development so `achar serve` works with no setup.
 */

export interface DataPaths {
  /** Volume root. */
  root: string;
  /** SQLite database file. */
  database: string;
  /** Per-job directories: generated output. */
  jobs: string;
  /** Uploaded traces, one directory per content hash. */
  traces: string;
  /** Machine presets: VMID and machine-profile files. */
  machines: string;
  /** Scratch space for request bodies being spooled before a parse. */
  spool: string;
}

const DEFAULT_DEV_ROOT = '.achar-data';

function resolveDataRoot(explicit?: string): string {
  const configured = explicit?.trim() || Bun.env.ACHAR_DATA_DIR?.trim();
  return path.resolve(configured || DEFAULT_DEV_ROOT);
}

/**
 * Resolves the layout and creates every directory in it.
 *
 * Directories are created eagerly at startup rather than lazily per request:
 * a volume that was never mounted should fail loudly while the operator is
 * still watching the logs, not on the first upload of the day.
 */
export function prepareDataPaths(explicit?: string): DataPaths {
  const root = resolveDataRoot(explicit);
  const paths: DataPaths = {
    root,
    database: path.join(root, 'achar.sqlite'),
    jobs: path.join(root, 'jobs'),
    traces: path.join(root, 'traces'),
    machines: path.join(root, 'machines'),
    spool: path.join(root, 'spool'),
  };

  for (const directory of [
    paths.root,
    paths.jobs,
    paths.traces,
    paths.machines,
    paths.spool,
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  return paths;
}

/** Directory holding one job's generated output. */
function jobDirectory(paths: DataPaths, jobId: string): string {
  return path.join(paths.jobs, jobId);
}

/**
 * Where an uploaded trace lives, addressed by its content hash.
 *
 * Content-addressed rather than per job, because the same file is routinely
 * posted more than once — for a second machine, or for a different set of
 * setups — and a job is no longer what owns the upload. It also means the
 * second upload of a file already on the volume costs nothing to store.
 */
export function traceFilePath(paths: DataPaths, sha256: string): string {
  return path.join(paths.traces, sha256, 'trace.MPF');
}

export function traceDirectory(paths: DataPaths, sha256: string): string {
  return path.join(paths.traces, sha256);
}

/**
 * Where a trace uploaded before traces were content-addressed still sits.
 *
 * Read only by the startup migration that moves it into the trace store.
 */
export function legacyJobTracePath(paths: DataPaths, jobId: string): string {
  return path.join(jobDirectory(paths, jobId), 'trace.MPF');
}

export function jobOutputDirectory(paths: DataPaths, jobId: string): string {
  return path.join(jobDirectory(paths, jobId), 'out');
}
