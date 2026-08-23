import { busy, HttpError } from '../errors';
import type { WorkerResponse, WorkerTask } from './protocol';

/**
 * Runs parse tasks on worker threads, a fresh worker per task.
 *
 * Concurrency is bounded by **memory, not CPU**. A 311 MB trace peaks around
 * 2 GB while parsing, so two at once needs more headroom than a typical
 * deployment has; the default of one slot is the honest figure, and raising it
 * is a decision about the host's RAM.
 *
 * Two ways in:
 *
 * - {@link WorkerPool.run} queues. Browser jobs use it, because an operator who
 *   uploaded a file should be told they are third in line, not turned away.
 * - {@link WorkerPool.tryRun} refuses with `503` when every slot is busy. The
 *   `/v1` routes use it, preserving the non-queueing behaviour their callers
 *   already handle — a stateless API client would rather retry than hold a
 *   connection open behind an unbounded queue.
 */

export interface WorkerPoolOptions {
  /** Concurrent workers. Defaults to 1. */
  size?: number;
  /** Hard ceiling on a single task before the worker is killed. */
  taskTimeoutMs?: number;
}

const DEFAULT_SIZE = 1;
const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_AFTER_SECONDS = 5;

export interface RunOptions {
  /**
   * Called when a worker actually picks the task up, as opposed to when it
   * was accepted. A queued job is 'queued' until this fires, which is what
   * lets the browser show a position rather than a spinner that means nothing.
   */
  onStart?: () => void;
}

interface Waiter {
  task: WorkerTask;
  onStart?: () => void;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class WorkerPool {
  private readonly size: number;
  private readonly taskTimeoutMs: number;
  private readonly waiting: Waiter[] = [];
  private readonly live = new Set<Worker>();
  private active = 0;
  private stopped = false;

  constructor(options: WorkerPoolOptions = {}) {
    this.size = Math.max(1, Math.floor(options.size ?? DEFAULT_SIZE));
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  }

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  get capacity(): number {
    return this.size;
  }

  /** Queues the task and resolves when a worker has finished it. */
  run<T>(task: WorkerTask, options: RunOptions = {}): Promise<T> {
    if (this.stopped) {
      return Promise.reject(new Error('The worker pool is shutting down.'));
    }
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        task,
        onStart: options.onStart,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  /** Runs immediately, or rejects with `503 busy` if no slot is free. */
  tryRun<T>(task: WorkerTask): Promise<T> {
    if (this.active >= this.size || this.waiting.length > 0) {
      return Promise.reject(busy(RETRY_AFTER_SECONDS));
    }
    return this.run<T>(task);
  }

  private pump(): void {
    while (this.active < this.size && this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      if (!waiter) return;
      this.active += 1;
      void this.execute(waiter);
    }
  }

  private async execute(waiter: Waiter): Promise<void> {
    try {
      waiter.onStart?.();
      waiter.resolve(await this.dispatch(waiter.task));
    } catch (error) {
      waiter.reject(error);
    } finally {
      this.active -= 1;
      this.pump();
    }
  }

  private dispatch(task: WorkerTask): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url).href, {
        type: 'module',
      });
      this.live.add(worker);

      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.live.delete(worker);
        worker.terminate();
        settle();
      };

      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new HttpError(
              504,
              'internal',
              'The trace took too long to process and was stopped.',
            ),
          ),
        );
      }, this.taskTimeoutMs);

      worker.addEventListener('message', (event: MessageEvent) => {
        const response = event.data as WorkerResponse;
        finish(() => {
          if (response.ok) {
            resolve(response.value);
            return;
          }
          const { status, code, message } = response.failure;
          reject(new HttpError(status, code as never, message));
        });
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        finish(() =>
          reject(
            new HttpError(
              500,
              'internal',
              `The trace could not be processed: ${event.message}`,
            ),
          ),
        );
      });

      // A worker killed by the OS out-of-memory reaper reports no error at
      // all, it simply stops. Without this the caller waits for the timeout
      // and learns nothing; with it they are told the trace was too large for
      // the service as configured.
      worker.addEventListener('close', () => {
        finish(() =>
          reject(
            new HttpError(
              503,
              'busy',
              'The processing worker stopped unexpectedly, most likely because the trace exceeded the memory available to this service.',
            ),
          ),
        );
      });

      worker.postMessage(task);
    });
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(new Error('The server is shutting down.'));
    }
    for (const worker of this.live) worker.terminate();
    this.live.clear();
  }
}
