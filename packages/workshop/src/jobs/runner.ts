import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AnalyzeOutcome, BundleOutcome, WorkerPool } from '@achar/server';
import { messageOf } from '@achar/server';
import type { DataPaths } from '../data/paths';
import {
  jobOutputDirectory,
  traceDirectory,
  traceFilePath,
} from '../data/paths';
import type { JobFileRecord, JobRecord, JobStore } from '../data/store';
import { loadMachineDocuments } from '../machines';

/**
 * Drives a submitted job from `queued` through to `done` or `failed`.
 *
 * The runner owns the database side of a job's life; the pool owns the thread
 * it runs on. Keeping those apart means a crashed worker is a failed row
 * rather than a lost job, and a restart can pick up whatever was in flight.
 */

export interface JobRunnerOptions {
  /** How long an uploaded trace is kept before the sweep deletes it. */
  retentionDays?: number;
  /** Interval between retention sweeps. */
  sweepIntervalMs?: number;
}

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class JobRunner {
  private readonly retentionMs: number;
  private readonly sweepIntervalMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: JobStore,
    private readonly paths: DataPaths,
    private readonly pool: WorkerPool,
    options: JobRunnerOptions = {},
  ) {
    this.retentionMs =
      (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  /**
   * Restores the queue after a restart.
   *
   * A row left `running` has no worker behind it any more — the process that
   * owned it is gone. Re-queueing is safe because a job is a pure function of
   * its trace and machine, so re-running produces the same output.
   */
  recover(): void {
    const interrupted = this.store.requeueInterrupted();
    const pending = this.store.listQueued();
    if (interrupted > 0 || pending.length > 0) {
      console.log(
        `[achar] resuming ${pending.length} queued job(s) (${interrupted} interrupted by the last shutdown)`,
      );
    }
    for (const job of pending) this.submit(job.id);

    // An upload whose analysis was interrupted is a trace the operator is
    // still staring at a spinner for. Same argument as a job: analysis is a
    // pure function of the file, so re-running it is safe.
    const analyzing = this.store.listAnalyzingTraces();
    if (analyzing.length > 0) {
      console.log(`[achar] resuming ${analyzing.length} trace analysis(es)`);
    }
    for (const trace of analyzing) this.analyze(trace.sha256);
  }

  /** Starts the machine-independent analysis of an upload. Returns at once. */
  analyze(sha256: string): void {
    void this.runAnalysis(sha256);
  }

  private async runAnalysis(sha256: string): Promise<void> {
    try {
      const outcome = await this.pool.run<AnalyzeOutcome>({
        op: 'analyze',
        tracePath: traceFilePath(this.paths, sha256),
      });
      this.store.markTraceReady(sha256, outcome);
    } catch (error) {
      this.store.markTraceFailed(sha256, {
        code: statusOf(error),
        message: messageOf(error),
      });
    }
  }

  /** Hands a queued job to the pool. Returns immediately. */
  submit(jobId: string): void {
    void this.execute(jobId);
  }

  private async execute(jobId: string): Promise<void> {
    try {
      const job = this.store.findJob(jobId);
      if (!job) return;

      const machine = await loadMachineDocuments(
        this.store,
        this.paths,
        job.machineId,
      );

      const outcome = await this.pool.run<BundleOutcome>(
        {
          op: 'bundle',
          tracePath: traceFilePath(this.paths, job.traceSha256),
          postId: machine.postId,
          vmid: machine.vmid,
          machineProfile: machine.machineProfile,
          programName: job.programName ?? undefined,
          setups: parseSetupsColumn(job.setups),
          keepAllTools: job.keepAllTools,
        },
        { onStart: () => this.store.markRunning(jobId) },
      );

      // Where output lives is this package's business, not the parser's: the
      // worker hands back the generated files and they are written here.
      const files = await this.writeOutput(jobId, outcome.files);

      // A blocked trace is a finished job, not a failed one: the operator gets
      // diagnostics, cycle time and a tool list, just no G-code. Recording it
      // as `done` keeps it in history where they can see why it was refused.
      this.store.markDone(jobId, {
        files,
        diagnostics: outcome.diagnostics,
        timing: outcome.timing,
        profile: outcome.profile,
        selectedSetups: outcome.selectedSetups,
      });
    } catch (error) {
      this.store.markFailed(jobId, {
        code: statusOf(error),
        message: messageOf(error),
      });
    }
  }

  /** Writes a finished job's output to its directory on the volume. */
  private async writeOutput(
    jobId: string,
    files: BundleOutcome['files'],
  ): Promise<JobFileRecord[]> {
    if (files.length === 0) return [];

    const directory = jobOutputDirectory(this.paths, jobId);
    await mkdir(directory, { recursive: true });

    const written: JobFileRecord[] = [];
    for (const file of files) {
      await Bun.write(path.join(directory, file.name), file.code);
      written.push({
        name: file.name,
        bytes: file.bytes,
        lines: file.lines,
      });
    }
    return written;
  }

  // ---- retention --------------------------------------------------------

  startRetentionSweep(): void {
    void this.purgeExpiredTraces();
    this.sweepTimer = setInterval(() => {
      void this.purgeExpiredTraces();
    }, this.sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  stopRetentionSweep(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  /**
   * Deletes uploaded traces past the retention window.
   *
   * Only the trace goes. Job rows and their generated output are kilobytes
   * against the trace's hundreds of megabytes, so history costs almost nothing
   * to keep and is the only record of what was posted for which machine. The
   * trace's analysis stays too: the setup list and cycle time of a file nobody
   * has the bytes of any more are still worth reading.
   */
  async purgeExpiredTraces(): Promise<number> {
    const expired = this.store.findTracesToPurge(this.retentionMs);
    let purged = 0;

    for (const trace of expired) {
      try {
        await rm(traceDirectory(this.paths, trace.sha256), {
          recursive: true,
          force: true,
        });
        this.store.markTracePurged(trace.sha256);
        purged += 1;
      } catch (error) {
        console.error(
          `[achar] could not purge trace ${trace.sha256}: ${messageOf(error)}`,
        );
      }
    }

    if (purged > 0) console.log(`[achar] purged ${purged} expired trace(s)`);
    return purged;
  }
}

/** An `HttpError`'s status when the failure carries one, else 'internal'. */
function statusOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'status' in error
    ? String((error as { status: unknown }).status)
    : 'internal';
}

/** The stored `1,3` selection as the indices the worker expects. */
function parseSetupsColumn(setups: string | null): number[] | undefined {
  if (setups === null) return undefined;
  return setups
    .split(',')
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index > 0);
}

/** The shape the browser polls. */
export interface JobView {
  id: string;
  status: JobRecord['status'];
  /** 1-based place in line; only meaningful while queued. */
  position?: number;
  traceName: string;
  traceBytes: number;
  machineId: string;
  machineName: string | null;
  programName: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  files: Array<{ name: string; bytes: number; lines: number }>;
  diagnostics: unknown;
  timing: unknown;
  profile: unknown;
  blocked: boolean;
  error: string | null;
  /** True once the uploaded trace has been deleted by the retention sweep. */
  tracePurged: boolean;
  /** Content hash of the trace, which is also its address for a re-post. */
  traceSha256: string;
  /** Selected setup indices, or null when the job covers the whole part. */
  setups: number[] | null;
  keepAllTools: boolean;
  /** What the finished program covers, once it is known. */
  selectedSetups: unknown;
}

export function describeJob(store: JobStore, job: JobRecord): JobView {
  const files = job.status === 'done' ? store.listFiles(job.id) : [];
  const diagnostics = parseJson(job.diagnostics) ?? [];
  const trace = store.findTrace(job.traceSha256);

  return {
    id: job.id,
    status: job.status,
    position: job.status === 'queued' ? store.queuePosition(job.id) : undefined,
    traceName: job.traceName,
    traceBytes: job.traceBytes,
    machineId: job.machineId,
    machineName: store.findMachine(job.machineId)?.name ?? null,
    programName: job.programName,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs:
      job.startedAt && job.finishedAt ? job.finishedAt - job.startedAt : null,
    files,
    diagnostics,
    timing: parseJson(job.timing),
    profile: parseJson(job.profile),
    // A finished job with diagnostics but no files was refused on content.
    blocked: job.status === 'done' && files.length === 0,
    error: job.errorMessage,
    // No row at all means the trace predates the store or was swept with it;
    // either way the bytes are not there to hand back.
    tracePurged: trace === undefined || trace.purgedAt !== null,
    traceSha256: job.traceSha256,
    setups: parseSetupsColumn(job.setups) ?? null,
    keepAllTools: job.keepAllTools,
    selectedSetups: parseJson(job.selectedSetups),
  };
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
