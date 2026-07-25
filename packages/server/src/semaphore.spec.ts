import { describe, expect, it } from 'bun:test';
import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  it('hands out up to the limit and then refuses', () => {
    const gate = new Semaphore(2);

    const first = gate.tryAcquire();
    const second = gate.tryAcquire();
    const third = gate.tryAcquire();

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Refused rather than queued: the caller gets a 503 it can retry.
    expect(third).toBeUndefined();
    expect(gate.inFlight).toBe(2);
  });

  it('frees a slot on release', () => {
    const gate = new Semaphore(1);
    const release = gate.tryAcquire();
    expect(gate.tryAcquire()).toBeUndefined();

    release?.();

    expect(gate.inFlight).toBe(0);
    expect(gate.tryAcquire()).toBeDefined();
  });

  it('ignores a repeated release so a double finally cannot over-free', () => {
    const gate = new Semaphore(1);
    const release = gate.tryAcquire();

    release?.();
    release?.();

    expect(gate.inFlight).toBe(0);
    // A second acquire must still be the only one available.
    expect(gate.tryAcquire()).toBeDefined();
    expect(gate.tryAcquire()).toBeUndefined();
  });

  it('treats a limit below one as one', () => {
    const gate = new Semaphore(0);

    expect(gate.tryAcquire()).toBeDefined();
    expect(gate.tryAcquire()).toBeUndefined();
  });
});
