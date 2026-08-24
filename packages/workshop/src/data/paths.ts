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
  /** Per-job directories. */
  jobs: string;
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
    machines: path.join(root, 'machines'),
    spool: path.join(root, 'spool'),
  };

  for (const directory of [
    paths.root,
    paths.jobs,
    paths.machines,
    paths.spool,
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  return paths;
}

/** Directory holding one job's spooled trace and generated output. */
function jobDirectory(paths: DataPaths, jobId: string): string {
  return path.join(paths.jobs, jobId);
}

export function jobTracePath(paths: DataPaths, jobId: string): string {
  return path.join(jobDirectory(paths, jobId), 'trace.MPF');
}

export function jobOutputDirectory(paths: DataPaths, jobId: string): string {
  return path.join(jobDirectory(paths, jobId), 'out');
}
