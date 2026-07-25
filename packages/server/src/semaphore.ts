/**
 * Non-queueing concurrency gate for trace parsing.
 *
 * Parsing is the expensive part of every trace endpoint: the largest fixture
 * in this repo is 67 MB and costs ~5.8 s and ~773 MB of peak RSS for 228k
 * events. Two of those at once will exhaust a modest host, so the gate refuses
 * work it cannot start rather than queueing it — a caller that gets `503` can
 * retry, whereas a caller stuck behind an unbounded queue just times out while
 * the server slides into swap.
 */
export class Semaphore {
  private readonly limit: number;
  private active = 0;

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get inFlight(): number {
    return this.active;
  }

  /**
   * Claims a slot, or returns `undefined` when all slots are busy. The
   * returned release function is idempotent, so a caller can safely put it in
   * a `finally` that may run twice.
   */
  tryAcquire(): (() => void) | undefined {
    if (this.active >= this.limit) return undefined;
    this.active += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}
