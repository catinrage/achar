/**
 * Wraps a value in an array if it is not already an array.
 * @param value - The value to wrap.
 * @returns The wrapped value as an array.
 */
export function wrapInArray<T>(value: T[] | T): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

/**
 * Timer class for measuring performance.
 */
export class PerformanceTimer {
  private times: number[] = [];
  private startTime: number = 0;

  constructor(public name: string) {}

  start() {
    this.startTime = performance.now();
    return this;
  }

  pause() {
    const endTime = performance.now();
    const elapsed = endTime - this.startTime;
    this.times.push(elapsed);
    return this;
  }

  getTotalTime() {
    return this.times.reduce((total, time) => total + time, 0);
  }

  print() {
    const totalTime = this.getTotalTime();
    console.log(`Timer: ${this.name}`);
    console.log(`Proc: ${this.times.length}`);
    console.log(`Total time: ${totalTime.toFixed(2)}ms`);
    console.log(
      `Average time: ${(totalTime / this.times.length).toFixed(2)}ms`,
    );
    console.log(`Max time: ${Math.max(...this.times).toFixed(2)}ms`);
    console.log(`Min time: ${Math.min(...this.times).toFixed(2)}ms`);
    console.log();
  }

  static printAll() {
    Object.keys(PerformanceTimer.timers).forEach((name) => {
      PerformanceTimer.timers[name].print();
    });
    if (Object.keys(PerformanceTimer.timers).length === 0) {
      console.log('No timers to print.');
    }
  }

  static timer(name: string) {
    if (!PerformanceTimer.timers[name]) {
      PerformanceTimer.timers[name] = new PerformanceTimer(name);
    }
    return PerformanceTimer.timers[name];
  }

  static timers: Record<string, PerformanceTimer> = {};
}

export function warn(message: string) {
  console.log(`Warning: ${message}`);
}
