import { Database } from 'bun:sqlite';
import type { DataPaths } from './paths';

/**
 * SQLite-backed state for the workshop service.
 *
 * Job rows outlive their uploads on purpose. A 311 MB trace produces a few
 * hundred kilobytes of G-code, so keeping every result costs nothing while
 * keeping every input would fill the volume within weeks — see
 * {@link JobStore.purgeExpiredTraces}.
 */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface MachineRecord {
  id: string;
  name: string;
  postId: string;
  /** Filename inside `machines/<id>/`, or null when the machine has none. */
  vmidFile: string | null;
  profileFile: string | null;
  createdAt: number;
}

export interface JobFileRecord {
  name: string;
  bytes: number;
  lines: number;
}

export interface JobRecord {
  id: string;
  traceSha256: string;
  traceName: string;
  traceBytes: number;
  machineId: string;
  programName: string | null;
  status: JobStatus;
  errorCode: string | null;
  errorMessage: string | null;
  /** JSON payloads, stored verbatim as core produced them. */
  diagnostics: string | null;
  timing: string | null;
  profile: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  tracePurgedAt: number | null;
}

interface JobRow {
  id: string;
  trace_sha256: string;
  trace_name: string;
  trace_bytes: number;
  machine_id: string;
  program_name: string | null;
  status: JobStatus;
  error_code: string | null;
  error_message: string | null;
  diagnostics: string | null;
  timing: string | null;
  profile: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  trace_purged_at: number | null;
}

interface MachineRow {
  id: string;
  name: string;
  post_id: string;
  vmid_file: string | null;
  profile_file: string | null;
  created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS machines (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  post_id       TEXT NOT NULL,
  vmid_file     TEXT,
  profile_file  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  trace_sha256    TEXT NOT NULL,
  trace_name      TEXT NOT NULL,
  trace_bytes     INTEGER NOT NULL,
  machine_id      TEXT NOT NULL,
  program_name    TEXT,
  status          TEXT NOT NULL,
  error_code      TEXT,
  error_message   TEXT,
  diagnostics     TEXT,
  timing          TEXT,
  profile         TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  trace_purged_at INTEGER
);

CREATE TABLE IF NOT EXISTS job_files (
  job_id  TEXT NOT NULL,
  name    TEXT NOT NULL,
  bytes   INTEGER NOT NULL,
  lines   INTEGER NOT NULL,
  PRIMARY KEY (job_id, name)
);

-- The cache key: same trace, same machine, same output.
CREATE INDEX IF NOT EXISTS jobs_cache
  ON jobs (trace_sha256, machine_id, status);

CREATE INDEX IF NOT EXISTS jobs_recent ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, created_at);
`;

export class JobStore {
  private readonly db: Database;

  constructor(paths: DataPaths) {
    this.db = new Database(paths.database, { create: true });
    // WAL keeps a reader (the HTTP thread answering a poll) from blocking on
    // the writer (a finishing job), which is the whole access pattern here.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- machines ---------------------------------------------------------

  listMachines(): MachineRecord[] {
    const rows = this.db
      .query<MachineRow, []>('SELECT * FROM machines ORDER BY name')
      .all();
    return rows.map(toMachine);
  }

  findMachine(id: string): MachineRecord | undefined {
    const row = this.db
      .query<MachineRow, [string]>('SELECT * FROM machines WHERE id = ?')
      .get(id);
    return row ? toMachine(row) : undefined;
  }

  upsertMachine(machine: MachineRecord): void {
    this.db
      .query(
        `INSERT INTO machines (id, name, post_id, vmid_file, profile_file, created_at)
         VALUES ($id, $name, $postId, $vmidFile, $profileFile, $createdAt)
         ON CONFLICT(id) DO UPDATE SET
           name = $name, post_id = $postId,
           vmid_file = $vmidFile, profile_file = $profileFile`,
      )
      .run({
        $id: machine.id,
        $name: machine.name,
        $postId: machine.postId,
        $vmidFile: machine.vmidFile,
        $profileFile: machine.profileFile,
        $createdAt: machine.createdAt,
      });
  }

  deleteMachine(id: string): void {
    this.db.query('DELETE FROM machines WHERE id = ?').run(id);
  }

  // ---- jobs -------------------------------------------------------------

  createJob(job: {
    id: string;
    traceSha256: string;
    traceName: string;
    traceBytes: number;
    machineId: string;
    programName: string | null;
  }): void {
    this.db
      .query(
        `INSERT INTO jobs
           (id, trace_sha256, trace_name, trace_bytes, machine_id,
            program_name, status, created_at)
         VALUES ($id, $sha, $name, $bytes, $machine, $program, 'queued', $now)`,
      )
      .run({
        $id: job.id,
        $sha: job.traceSha256,
        $name: job.traceName,
        $bytes: job.traceBytes,
        $machine: job.machineId,
        $program: job.programName,
        $now: Date.now(),
      });
  }

  findJob(id: string): JobRecord | undefined {
    const row = this.db
      .query<JobRow, [string]>('SELECT * FROM jobs WHERE id = ?')
      .get(id);
    return row ? toJob(row) : undefined;
  }

  /**
   * The most recent successful job for this exact trace and machine.
   *
   * Generation is deterministic, so re-running it would burn 15 seconds to
   * reproduce bytes that are already on disk. Returning the earlier job also
   * makes "two people uploaded the same file" provably identical rather than
   * merely expected to match.
   */
  findCachedJob(traceSha256: string, machineId: string): JobRecord | undefined {
    const row = this.db
      .query<JobRow, [string, string]>(
        `SELECT * FROM jobs
          WHERE trace_sha256 = ? AND machine_id = ?
            AND status = 'done' AND trace_purged_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(traceSha256, machineId);
    return row ? toJob(row) : undefined;
  }

  // Reached through the store held by the route context, which fallow's
  // syntactic member analysis cannot follow back to this class.
  // fallow-ignore-next-line unused-class-member
  listRecentJobs(limit: number): JobRecord[] {
    const rows = this.db
      .query<JobRow, [number]>(
        'SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?',
      )
      .all(limit);
    return rows.map(toJob);
  }

  /** Queued jobs in submission order — the queue itself. */
  listQueued(): JobRecord[] {
    const rows = this.db
      .query<JobRow, []>(
        "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at",
      )
      .all();
    return rows.map(toJob);
  }

  /** 1-based position in the queue, or 0 when the job is not queued. */
  queuePosition(id: string): number {
    const row = this.db
      .query<{ position: number }, [string]>(
        `SELECT COUNT(*) + 1 AS position FROM jobs
          WHERE status = 'queued'
            AND created_at < (SELECT created_at FROM jobs WHERE id = ?)`,
      )
      .get(id);
    return row?.position ?? 0;
  }

  markRunning(id: string): void {
    this.db
      .query("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?")
      .run(Date.now(), id);
  }

  markDone(
    id: string,
    result: {
      files: JobFileRecord[];
      diagnostics: unknown;
      timing: unknown;
      profile: unknown;
    },
  ): void {
    const write = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE jobs SET status = 'done', finished_at = $now,
             diagnostics = $diagnostics, timing = $timing, profile = $profile
           WHERE id = $id`,
        )
        .run({
          $id: id,
          $now: Date.now(),
          $diagnostics: JSON.stringify(result.diagnostics ?? []),
          $timing: JSON.stringify(result.timing ?? null),
          $profile: JSON.stringify(result.profile ?? null),
        });

      this.db.query('DELETE FROM job_files WHERE job_id = ?').run(id);
      const insert = this.db.query(
        'INSERT INTO job_files (job_id, name, bytes, lines) VALUES (?, ?, ?, ?)',
      );
      for (const file of result.files) {
        insert.run(id, file.name, file.bytes, file.lines);
      }
    });
    write();
  }

  markFailed(
    id: string,
    error: { code: string; message: string; diagnostics?: unknown },
  ): void {
    this.db
      .query(
        `UPDATE jobs SET status = 'failed', finished_at = $now,
           error_code = $code, error_message = $message,
           diagnostics = $diagnostics
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $now: Date.now(),
        $code: error.code,
        $message: error.message,
        $diagnostics:
          error.diagnostics === undefined
            ? null
            : JSON.stringify(error.diagnostics),
      });
  }

  /**
   * Re-queues jobs left mid-flight by a restart.
   *
   * A `running` row with no live worker behind it would otherwise sit there
   * forever, and its uploader would poll a status that never changes.
   */
  requeueInterrupted(): number {
    const result = this.db
      .query(
        "UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'",
      )
      .run();
    return result.changes;
  }

  listFiles(jobId: string): JobFileRecord[] {
    return this.db
      .query<JobFileRecord, [string]>(
        'SELECT name, bytes, lines FROM job_files WHERE job_id = ? ORDER BY name',
      )
      .all(jobId);
  }

  // ---- retention --------------------------------------------------------

  /** Jobs whose uploaded trace is older than the window and still present. */
  findTracesToPurge(olderThanMs: number): JobRecord[] {
    const cutoff = Date.now() - olderThanMs;
    const rows = this.db
      .query<JobRow, [number]>(
        `SELECT * FROM jobs
          WHERE trace_purged_at IS NULL
            AND created_at < ?
            AND status IN ('done', 'failed')`,
      )
      .all(cutoff);
    return rows.map(toJob);
  }

  markTracePurged(id: string): void {
    this.db
      .query('UPDATE jobs SET trace_purged_at = ? WHERE id = ?')
      .run(Date.now(), id);
  }
}

function toMachine(row: MachineRow): MachineRecord {
  return {
    id: row.id,
    name: row.name,
    postId: row.post_id,
    vmidFile: row.vmid_file,
    profileFile: row.profile_file,
    createdAt: row.created_at,
  };
}

function toJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    traceSha256: row.trace_sha256,
    traceName: row.trace_name,
    traceBytes: row.trace_bytes,
    machineId: row.machine_id,
    programName: row.program_name,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    diagnostics: row.diagnostics,
    timing: row.timing,
    profile: row.profile,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    tracePurgedAt: row.trace_purged_at,
  };
}
