import { rm } from 'node:fs/promises';
import type { DataPaths } from '../data/paths';
import { jobOutputDirectory, jobTracePath } from '../data/paths';
import type { JobRecord, JobStore } from '../data/store';
import { messageOf } from '../errors';
import { loadMachineDocuments } from '../machines';
import type { WorkerPool } from './pool';
import type { JobOutcome } from './protocol';

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

      const outcome = await this.pool.run<JobOutcome>(
        {
          op: 'job',
          tracePath: jobTracePath(this.paths, jobId),
          outDir: jobOutputDirectory(this.paths, jobId),
          postId: machine.postId,
          vmid: machine.vmid,
          machineProfile: machine.machineProfile,
          programName: job.programName ?? undefined,
        },
        { onStart: () => this.store.markRunning(jobId) },
      );

      // A blocked trace is a finished job, not a failed one: the operator gets
      // diagnostics, cycle time and a tool list, just no G-code. Recording it
      // as `done` keeps it in history where they can see why it was refused.
      this.store.markDone(jobId, {
        files: outcome.files,
        diagnostics: outcome.diagnostics,
        timing: outcome.timing,
        profile: outcome.profile,
      });
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? String((error as { status: unknown }).status)
          : 'internal';
      this.store.markFailed(jobId, {
        code: status,
        message: messageOf(error),
      });
    }
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
   * Only the trace goes. The job row and its generated output are kilobytes
   * against the trace's hundreds of megabytes, so history costs almost nothing
   * to keep and is the only record of what was posted for which machine.
   */
  async purgeExpiredTraces(): Promise<number> {
    const expired = this.store.findTracesToPurge(this.retentionMs);
    let purged = 0;

    for (const job of expired) {
      try {
        await rm(jobTracePath(this.paths, job.id), { force: true });
        this.store.markTracePurged(job.id);
        purged += 1;
      } catch (error) {
        console.error(
          `[achar] could not purge the trace for job ${job.id}: ${messageOf(error)}`,
        );
      }
    }

    if (purged > 0) console.log(`[achar] purged ${purged} expired trace(s)`);
    return purged;
  }
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
}

export function describeJob(store: JobStore, job: JobRecord): JobView {
  const files = job.status === 'done' ? store.listFiles(job.id) : [];
  const diagnostics = parseJson(job.diagnostics) ?? [];

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
    tracePurged: job.tracePurgedAt !== null,
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
