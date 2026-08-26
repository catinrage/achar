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
  /**
   * The machine profile as a JSON document, or null when the machine has none.
   *
   * A column rather than a file beside the VMID. The VMID is an artefact from
   * the machine builder that nobody authors by hand; the profile is a record
   * this application owns, edited field by field through a form, and a record
   * belongs in the database that already holds every other record here. It
   * also removes the two-writes problem — a row saying a machine has a profile
   * and a directory that disagrees.
   */
  profile: string | null;
  createdAt: number;
  /**
   * Bumped on every write to the machine, and the reason a cached job is
   * still the right answer.
   *
   * A job's output is a function of the trace *and* the machine, but the
   * machine is referenced by id, so the id alone cannot tell two runs apart
   * once the machine has been edited underneath them. Editing a machine's
   * dialect and re-posting the same trace used to hand back the pre-edit
   * G-code. The revision closes that: it travels onto the job row, and a job
   * posted against a configuration that no longer exists can no longer be
   * served from cache.
   *
   * Owned by {@link JobStore.upsertMachine}, which is why it is absent from
   * {@link MachineDefinition}. It counts writes rather than changes: a save
   * that alters nothing still bumps it. That over-invalidates by one
   * regeneration, which costs seconds; under-invalidating costs a wrong
   * program on a machine, and the VMID — a file on the volume that this row
   * only names — can change without any column here changing at all.
   */
  revision: number;
}

/**
 * A machine as its callers state it: everything except the revision, which
 * only the store is allowed to set.
 */
export type MachineDefinition = Omit<MachineRecord, 'revision'>;

/**
 * An uploaded trace, independent of any job posted from it.
 *
 * A trace is not a property of a job: the operator has to see what is *in* the
 * file — which setups, how long each runs — before choosing what to generate,
 * and the same file is routinely posted again for another machine or another
 * setup. So it is stored once, keyed by content hash, analysed once, and
 * referenced by every job built from it.
 */
export interface TraceRecord {
  sha256: string;
  name: string;
  bytes: number;
  status: TraceStatus;
  errorCode: string | null;
  errorMessage: string | null;
  /** JSON payloads, stored verbatim as the analysis produced them. */
  setups: string | null;
  hasImplicitSetup: boolean;
  timing: string | null;
  profile: string | null;
  diagnostics: string | null;
  eventCount: number | null;
  createdAt: number;
  purgedAt: number | null;
}

export type TraceStatus = 'analyzing' | 'ready' | 'failed';

export interface JobFileRecord {
  name: string;
  bytes: number;
  lines: number;
}

export interface JobRecord {
  id: string;
  traceSha256: string;
  /**
   * Copied from the trace at submission time rather than joined.
   *
   * History outlives retention: the trace row and the file are both gone
   * fourteen days later, and "which file was this posted from" is exactly what
   * someone reading history a month afterwards is asking.
   */
  traceName: string;
  traceBytes: number;
  machineId: string;
  programName: string | null;
  /**
   * Selected setup indices as a canonical `1,3`, or null for the whole part.
   * Part of the cache key: the same trace and machine posted for different
   * setups are different programs.
   */
  setups: string | null;
  keepAllTools: boolean;
  /**
   * The machine's `revision` when this job was posted, or null for a job that
   * predates the column. Part of the cache key — see {@link MachineRecord.revision}.
   */
  machineRevision: number | null;
  /** JSON `SetupOverview[]` for what the finished program covers. */
  selectedSetups: string | null;
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
}

interface JobRow {
  id: string;
  trace_sha256: string;
  trace_name: string;
  trace_bytes: number;
  machine_id: string;
  program_name: string | null;
  setups: string | null;
  keep_all_tools: number | null;
  machine_revision: number | null;
  selected_setups: string | null;
  status: JobStatus;
  error_code: string | null;
  error_message: string | null;
  diagnostics: string | null;
  timing: string | null;
  profile: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

interface MachineRow {
  id: string;
  name: string;
  post_id: string;
  vmid_file: string | null;
  profile: string | null;
  created_at: number;
  revision: number;
}

interface TraceRow {
  sha256: string;
  name: string;
  bytes: number;
  status: TraceStatus;
  error_code: string | null;
  error_message: string | null;
  setups: string | null;
  has_implicit_setup: number;
  timing: string | null;
  profile: string | null;
  diagnostics: string | null;
  event_count: number | null;
  created_at: number;
  purged_at: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS machines (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  post_id       TEXT NOT NULL,
  vmid_file     TEXT,
  profile       TEXT,
  created_at    INTEGER NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 1
);

-- Uploads, keyed by content. One row per distinct file, however many jobs
-- were posted from it.
CREATE TABLE IF NOT EXISTS traces (
  sha256             TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  bytes              INTEGER NOT NULL,
  status             TEXT NOT NULL,
  error_code         TEXT,
  error_message      TEXT,
  setups             TEXT,
  has_implicit_setup INTEGER NOT NULL DEFAULT 0,
  timing             TEXT,
  profile            TEXT,
  diagnostics        TEXT,
  event_count        INTEGER,
  created_at         INTEGER NOT NULL,
  purged_at          INTEGER
);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  trace_sha256    TEXT NOT NULL,
  trace_name      TEXT NOT NULL,
  trace_bytes     INTEGER NOT NULL,
  machine_id      TEXT NOT NULL,
  program_name    TEXT,
  setups          TEXT,
  keep_all_tools  INTEGER NOT NULL DEFAULT 0,
  machine_revision INTEGER,
  selected_setups TEXT,
  status          TEXT NOT NULL,
  error_code      TEXT,
  error_message   TEXT,
  diagnostics     TEXT,
  timing          TEXT,
  profile         TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER
);

CREATE TABLE IF NOT EXISTS job_files (
  job_id  TEXT NOT NULL,
  name    TEXT NOT NULL,
  bytes   INTEGER NOT NULL,
  lines   INTEGER NOT NULL,
  PRIMARY KEY (job_id, name)
);

-- The cache key: same trace, same machine *version*, same selection, same
-- output. Only the selective columns are indexed; findCachedJob filters the
-- rest of the key off the handful of rows this leaves.
CREATE INDEX IF NOT EXISTS jobs_cache
  ON jobs (trace_sha256, machine_id, status);

CREATE INDEX IF NOT EXISTS traces_recent ON traces (created_at DESC);

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
    this.migrate();
  }

  /**
   * Brings a database created by an earlier version up to the current shape.
   *
   * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists,
   * so columns added after a deployment has run have to be added by hand. Each
   * one is additive and nullable, which is what makes replaying them on every
   * start safe.
   */
  private migrate(): void {
    this.addColumn('machines', 'profile', 'TEXT');
    this.addColumn('jobs', 'setups', 'TEXT');
    this.addColumn('jobs', 'keep_all_tools', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumn('jobs', 'selected_setups', 'TEXT');
    this.addColumn('machines', 'revision', 'INTEGER NOT NULL DEFAULT 1');
    // Deliberately nullable, and deliberately not backfilled. A job written
    // before this column existed was posted against a configuration nobody
    // recorded, so there is no value that would be true. NULL says so, and
    // `findCachedJob` refuses to serve those rows rather than assume they
    // match whatever the machine says today.
    this.addColumn('jobs', 'machine_revision', 'INTEGER');
  }

  private addColumn(table: string, column: string, type: string): void {
    const columns = this.db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all();
    if (columns.some((existing) => existing.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  /**
   * Machines whose profile is still a file on the volume.
   *
   * Profiles used to live in `machines/<id>/machine.json`. Moving them into
   * the database needs the filesystem, which this class deliberately has no
   * access to, so it reports what has to move and `migrateMachineProfiles`
   * does the reading.
   */
  listMachinesWithProfileFiles(): Array<{ id: string; file: string }> {
    const columns = this.db
      .query<{ name: string }, []>('PRAGMA table_info(machines)')
      .all();
    if (!columns.some((column) => column.name === 'profile_file')) return [];

    return this.db
      .query<{ id: string; file: string }, []>(
        `SELECT id, profile_file AS file FROM machines
          WHERE profile_file IS NOT NULL AND profile IS NULL`,
      )
      .all();
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

  /**
   * Writes a machine and advances its revision.
   *
   * The revision is set here rather than taken from the caller so that no
   * write path can forget to move it — every edit reaches this one statement,
   * including the ones whose only effect is on the VMID file beside the row.
   */
  upsertMachine(machine: MachineDefinition): void {
    this.db
      .query(
        `INSERT INTO machines (id, name, post_id, vmid_file, profile, created_at, revision)
         VALUES ($id, $name, $postId, $vmidFile, $profile, $createdAt, 1)
         ON CONFLICT(id) DO UPDATE SET
           name = $name, post_id = $postId,
           vmid_file = $vmidFile, profile = $profile,
           revision = machines.revision + 1`,
      )
      .run({
        $id: machine.id,
        $name: machine.name,
        $postId: machine.postId,
        $vmidFile: machine.vmidFile,
        $profile: machine.profile,
        $createdAt: machine.createdAt,
      });
  }

  deleteMachine(id: string): void {
    this.db.query('DELETE FROM machines WHERE id = ?').run(id);
  }

  // ---- traces -----------------------------------------------------------

  findTrace(sha256: string): TraceRecord | undefined {
    const row = this.db
      .query<TraceRow, [string]>('SELECT * FROM traces WHERE sha256 = ?')
      .get(sha256);
    return row ? toTrace(row) : undefined;
  }

  /** Records a newly uploaded trace as awaiting analysis. */
  createTrace(trace: { sha256: string; name: string; bytes: number }): void {
    this.db
      .query(
        `INSERT INTO traces (sha256, name, bytes, status, created_at)
         VALUES ($sha, $name, $bytes, 'analyzing', $now)
         ON CONFLICT(sha256) DO UPDATE SET
           name = $name, bytes = $bytes, status = 'analyzing',
           error_code = NULL, error_message = NULL,
           created_at = $now, purged_at = NULL`,
      )
      .run({
        $sha: trace.sha256,
        $name: trace.name,
        $bytes: trace.bytes,
        $now: Date.now(),
      });
  }

  /**
   * Restarts a known trace's retention clock, and takes the name it was last
   * uploaded under. A file someone is still working from should not expire on
   * the schedule of the first time anyone touched it.
   */
  touchTrace(sha256: string, name: string): void {
    this.db
      .query('UPDATE traces SET created_at = ?, name = ? WHERE sha256 = ?')
      .run(Date.now(), name, sha256);
  }

  markTraceReady(
    sha256: string,
    analysis: {
      setups: unknown;
      hasImplicitSetup: boolean;
      timing: unknown;
      profile: unknown;
      diagnostics: unknown;
      eventCount: number;
    },
  ): void {
    this.db
      .query(
        `UPDATE traces SET status = 'ready', error_code = NULL,
           error_message = NULL, setups = $setups,
           has_implicit_setup = $implicit, timing = $timing,
           profile = $profile, diagnostics = $diagnostics,
           event_count = $events
         WHERE sha256 = $sha`,
      )
      .run({
        $sha: sha256,
        $setups: JSON.stringify(analysis.setups ?? []),
        $implicit: analysis.hasImplicitSetup ? 1 : 0,
        $timing: JSON.stringify(analysis.timing ?? null),
        $profile: JSON.stringify(analysis.profile ?? null),
        $diagnostics: JSON.stringify(analysis.diagnostics ?? []),
        $events: analysis.eventCount,
      });
  }

  markTraceFailed(
    sha256: string,
    error: { code: string; message: string },
  ): void {
    this.db
      .query(
        `UPDATE traces SET status = 'failed', error_code = ?, error_message = ?
         WHERE sha256 = ?`,
      )
      .run(error.code, error.message, sha256);
  }

  /**
   * Adopts a trace that already exists on the volume, with no analysis.
   *
   * Only the legacy-upload migration uses this: the file is known good but
   * has never been analysed, and re-parsing every trace a deployment has ever
   * seen is not a reasonable thing to do at startup. Never overwrites a row
   * that has already been analysed.
   */
  adoptTrace(trace: {
    sha256: string;
    name: string;
    bytes: number;
    createdAt: number;
  }): void {
    this.db
      .query(
        `INSERT INTO traces (sha256, name, bytes, status, setups, created_at)
         VALUES ($sha, $name, $bytes, 'ready', '[]', $createdAt)
         ON CONFLICT(sha256) DO NOTHING`,
      )
      .run({
        $sha: trace.sha256,
        $name: trace.name,
        $bytes: trace.bytes,
        $createdAt: trace.createdAt,
      });
  }

  /**
   * Jobs whose upload may still be sitting in the job's own directory.
   *
   * Whether the file is actually there is a filesystem question, which this
   * class does not answer; the migration checks. Jobs whose trace is already
   * in the trace store are skipped here rather than stat-ed for nothing.
   */
  listJobsWithTraceCandidates(): JobRecord[] {
    return this.db
      .query<JobRow, []>(
        `SELECT * FROM jobs
          WHERE trace_sha256 NOT IN (SELECT sha256 FROM traces)
          ORDER BY created_at`,
      )
      .all()
      .map(toJob);
  }

  /** Traces left mid-analysis by a restart. */
  listAnalyzingTraces(): TraceRecord[] {
    return this.db
      .query<TraceRow, []>(
        "SELECT * FROM traces WHERE status = 'analyzing' AND purged_at IS NULL ORDER BY created_at",
      )
      .all()
      .map(toTrace);
  }

  // ---- jobs -------------------------------------------------------------

  createJob(job: {
    id: string;
    traceSha256: string;
    traceName: string;
    traceBytes: number;
    machineId: string;
    programName: string | null;
    setups: string | null;
    keepAllTools: boolean;
    machineRevision: number;
  }): void {
    this.db
      .query(
        `INSERT INTO jobs
           (id, trace_sha256, trace_name, trace_bytes, machine_id,
            program_name, setups, keep_all_tools, machine_revision,
            status, created_at)
         VALUES ($id, $sha, $name, $bytes, $machine, $program, $setups,
                 $keepAllTools, $revision, 'queued', $now)`,
      )
      .run({
        $id: job.id,
        $sha: job.traceSha256,
        $name: job.traceName,
        $bytes: job.traceBytes,
        $machine: job.machineId,
        $program: job.programName,
        $setups: job.setups,
        $keepAllTools: job.keepAllTools ? 1 : 0,
        $revision: job.machineRevision,
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
   * The most recent successful job for this exact trace and machine *version*.
   *
   * Generation is deterministic, so re-running it would burn 15 seconds to
   * reproduce bytes that are already on disk. Returning the earlier job also
   * makes "two people uploaded the same file" provably identical rather than
   * merely expected to match.
   *
   * Determinism is what the cache rests on, and it only holds while the inputs
   * hold. The machine is one of those inputs and it is mutable, so the match
   * is against `machine_revision` and not against `machine_id` alone —
   * otherwise editing a machine and re-posting hands back the pre-edit
   * program, which is a wrong answer delivered instantly.
   */
  findCachedJob(key: {
    traceSha256: string;
    machineId: string;
    programName: string | null;
    setups: string | null;
    keepAllTools: boolean;
    /**
     * The machine's revision *now*. A job posted against an earlier one used
     * a configuration that has since been edited, so its output is no longer
     * the answer to this request even though every other part of the key
     * matches.
     */
    machineRevision: number;
  }): JobRecord | undefined {
    const row = this.db
      .query<JobRow, Record<string, string | number | null>>(
        `SELECT jobs.* FROM jobs
           JOIN traces ON traces.sha256 = jobs.trace_sha256
          WHERE jobs.trace_sha256 = $sha AND jobs.machine_id = $machine
            AND jobs.status = 'done'
            AND jobs.program_name IS $program
            AND jobs.setups IS $setups
            AND jobs.keep_all_tools = $keepAllTools
            AND jobs.machine_revision IS $revision
            AND traces.purged_at IS NULL
          ORDER BY jobs.created_at DESC LIMIT 1`,
      )
      .get({
        $sha: key.traceSha256,
        $machine: key.machineId,
        $program: key.programName,
        $setups: key.setups,
        $keepAllTools: key.keepAllTools ? 1 : 0,
        $revision: key.machineRevision,
      });
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
      selectedSetups: unknown;
    },
  ): void {
    const write = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE jobs SET status = 'done', finished_at = $now,
             diagnostics = $diagnostics, timing = $timing, profile = $profile,
             selected_setups = $selected
           WHERE id = $id`,
        )
        .run({
          $id: id,
          $now: Date.now(),
          $diagnostics: JSON.stringify(result.diagnostics ?? []),
          $timing: JSON.stringify(result.timing ?? null),
          $profile: JSON.stringify(result.profile ?? null),
          $selected:
            result.selectedSetups === null ||
            result.selectedSetups === undefined
              ? null
              : JSON.stringify(result.selectedSetups),
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

  /**
   * Uploads older than the window whose file is still on the volume.
   *
   * A trace still being analysed, or one a queued job has not consumed yet, is
   * excluded: the sweep must not delete a file out from under a parse that is
   * about to read it.
   */
  findTracesToPurge(olderThanMs: number): TraceRecord[] {
    const cutoff = Date.now() - olderThanMs;
    return this.db
      .query<TraceRow, [number]>(
        `SELECT * FROM traces
          WHERE purged_at IS NULL
            AND created_at < ?
            AND status IN ('ready', 'failed')
            AND sha256 NOT IN (
              SELECT trace_sha256 FROM jobs
               WHERE status IN ('queued', 'running')
            )`,
      )
      .all(cutoff)
      .map(toTrace);
  }

  markTracePurged(sha256: string): void {
    this.db
      .query('UPDATE traces SET purged_at = ? WHERE sha256 = ?')
      .run(Date.now(), sha256);
  }
}

function toMachine(row: MachineRow): MachineRecord {
  return {
    id: row.id,
    name: row.name,
    postId: row.post_id,
    vmidFile: row.vmid_file,
    profile: row.profile,
    createdAt: row.created_at,
    revision: row.revision,
  };
}

function toTrace(row: TraceRow): TraceRecord {
  return {
    sha256: row.sha256,
    name: row.name,
    bytes: row.bytes,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    setups: row.setups,
    hasImplicitSetup: row.has_implicit_setup === 1,
    timing: row.timing,
    profile: row.profile,
    diagnostics: row.diagnostics,
    eventCount: row.event_count,
    createdAt: row.created_at,
    purgedAt: row.purged_at,
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
    setups: row.setups,
    keepAllTools: row.keep_all_tools === 1,
    machineRevision: row.machine_revision,
    selectedSetups: row.selected_setups,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    diagnostics: row.diagnostics,
    timing: row.timing,
    profile: row.profile,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
