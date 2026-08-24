import { createErrorContext, ValidationError } from './errors';
import type { EventConsumer } from './event-consumer';
import { runConsumer } from './event-consumer';
import type { EventData } from './parser';

/**
 * Machining-time extraction from Trace 5 events.
 *
 * SolidCAM stamps every `start_of_job` with `job_time`, `job_cutting_time`,
 * and `job_linking_time` as `H:MM:SS` strings, marks setup boundaries with
 * `@setup` events, and declares per-tool totals (`tool_work_time`) on
 * `def_tool`. This module aggregates those into a per-setup and per-tool
 * report; every job start counts as one executed instance, so repeated
 * pattern/re-post jobs raise the instance count each time they run.
 *
 * Transform instances (`used_in_transform_translate` / `_4x` / `_mirror` /
 * `_rotate`) re-emit the same job once per position, and SolidCAM stamps every
 * repeat with the time for the *whole* pattern rather than for one position.
 * SolidCAM forbids two operations sharing a name, so a repeated `job_name` is
 * always such a pattern: its time is therefore counted once, no matter how
 * many times the job starts. Counting it per repeat inflated both the job and
 * its tool by the transform's multiplier.
 */

export interface JobTiming {
  name: string;
  tool?: string;
  instances: number;
  seconds: number;
  cuttingSeconds: number;
  linkingSeconds: number;
  duration: string;
}

/** Per-tool roll-up scoped to a single setup. */
export interface SetupToolTiming {
  tool: string;
  seconds: number;
  duration: string;
  jobInstances: number;
}

export interface SetupTiming {
  name: string;
  seconds: number;
  duration: string;
  tools: SetupToolTiming[];
  jobs: JobTiming[];
}

export interface ToolTiming {
  tool: string;
  seconds: number;
  duration: string;
  jobInstances: number;
  /** `tool_work_time` as declared by SolidCAM on the tool definition. */
  declaredWorkTime?: string;
}

export interface TimingReport {
  seconds: number;
  duration: string;
  setups: SetupTiming[];
  tools: ToolTiming[];
}

/** Parses SolidCAM `H:MM:SS` duration strings (leading spaces tolerated). */
export function parseDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(\d+):([0-5]?\d):([0-5]?\d)$/);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function formatDurationSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

interface MutableJob {
  name: string;
  tool?: string;
  instances: number;
  seconds: number;
  cuttingSeconds: number;
  linkingSeconds: number;
}

interface MutableSetup {
  name: string;
  jobs: Map<string, MutableJob>;
}

/** The three durations SolidCAM stamps on a `start_of_job`. */
interface JobDurations {
  seconds: number;
  cuttingSeconds: number;
  linkingSeconds: number;
}

const NO_SETUP = '(no setup)';

const NO_DURATIONS: JobDurations = {
  seconds: 0,
  cuttingSeconds: 0,
  linkingSeconds: 0,
};

/**
 * Guards the assumption that repeats of one job name are transform instances
 * of a single operation: every repeat must carry the identical shared total.
 * Differing values mean the name is not the operation key this module takes it
 * for, and silently picking one of them would misreport machining time — so
 * the report fails instead.
 */
function assertRepeatMatches(
  name: string,
  first: JobDurations,
  repeat: JobDurations,
): void {
  if (
    first.seconds === repeat.seconds &&
    first.cuttingSeconds === repeat.cuttingSeconds &&
    first.linkingSeconds === repeat.linkingSeconds
  ) {
    return;
  }

  throw new ValidationError(
    `Job '${name}' repeats with different time data ` +
      `(first ${formatDurationSeconds(first.seconds)}, ` +
      `repeat ${formatDurationSeconds(repeat.seconds)}). ` +
      'SolidCAM operation names are unique, so repeats must be transform ' +
      'instances sharing one total time.',
    createErrorContext('timing', 'extractTimingReport', {
      job: name,
      first,
      repeat,
    }),
    { recoverable: false, strategy: 'abort' },
  );
}

/**
 * Aggregates jobs by their loaded tool, heaviest first. Jobs that ran before
 * any `change_tool` have no tool to attribute the time to and are skipped.
 */
function rollUpTools(jobs: JobTiming[]): SetupToolTiming[] {
  const totals = new Map<string, { seconds: number; instances: number }>();

  for (const job of jobs) {
    if (!job.tool) continue;
    const total = totals.get(job.tool) ?? { seconds: 0, instances: 0 };
    total.seconds += job.seconds;
    total.instances += job.instances;
    totals.set(job.tool, total);
  }

  return [...totals.entries()]
    .map(([tool, total]) => ({
      tool,
      seconds: total.seconds,
      duration: formatDurationSeconds(total.seconds),
      jobInstances: total.instances,
    }))
    .sort((left, right) => right.seconds - left.seconds);
}

export function createTimingConsumer(): EventConsumer<TimingReport> {
  const setups: MutableSetup[] = [];
  const declaredToolTimes = new Map<string, string>();
  /** Keyed by job name, spanning setups: SolidCAM names are program-unique. */
  const seenJobDurations = new Map<string, JobDurations>();
  let currentSetup: MutableSetup | undefined;
  let currentTool: string | undefined;

  const setupFor = (): MutableSetup => {
    if (!currentSetup) {
      currentSetup = { name: NO_SETUP, jobs: new Map() };
      setups.push(currentSetup);
    }
    return currentSetup;
  };

  const push = (event: EventData): void => {
    const data = event as unknown as Record<string, unknown>;
    switch (data._eventName) {
      case 'Setup': {
        currentSetup = {
          name: String(data.setup_name ?? `Setup${setups.length + 1}`),
          jobs: new Map(),
        };
        setups.push(currentSetup);
        break;
      }
      case 'ChangeTool': {
        if (typeof data.tool_id_string === 'string') {
          currentTool = data.tool_id_string;
        }
        break;
      }
      case 'DefTool': {
        if (
          typeof data.tool_id_string === 'string' &&
          typeof data.tool_work_time === 'string' &&
          !declaredToolTimes.has(data.tool_id_string)
        ) {
          declaredToolTimes.set(
            data.tool_id_string,
            data.tool_work_time.trim(),
          );
        }
        break;
      }
      case 'StartOfJob': {
        const name = String(data.job_name ?? data.original_job_name ?? '');
        const stamped: JobDurations = {
          seconds: parseDurationSeconds(data.job_time) ?? 0,
          cuttingSeconds: parseDurationSeconds(data.job_cutting_time) ?? 0,
          linkingSeconds: parseDurationSeconds(data.job_linking_time) ?? 0,
        };

        // A repeat re-states the pattern total already counted on the first
        // start, so it adds an instance and no time.
        const first = seenJobDurations.get(name);
        if (first) {
          assertRepeatMatches(name, first, stamped);
        } else {
          seenJobDurations.set(name, stamped);
        }
        const counted = first ? NO_DURATIONS : stamped;

        const setup = setupFor();
        const key = `${name}\0${currentTool ?? ''}`;
        const job = setup.jobs.get(key) ?? {
          name,
          tool: currentTool,
          instances: 0,
          seconds: 0,
          cuttingSeconds: 0,
          linkingSeconds: 0,
        };
        job.instances += 1;
        job.seconds += counted.seconds;
        job.cuttingSeconds += counted.cuttingSeconds;
        job.linkingSeconds += counted.linkingSeconds;
        setup.jobs.set(key, job);
        break;
      }
      default:
        break;
    }
  };

  const finish = (): TimingReport => {
    const setupTimings: SetupTiming[] = setups.map((setup) => {
      const jobs = [...setup.jobs.values()].map((job) => ({
        ...job,
        duration: formatDurationSeconds(job.seconds),
      }));
      const seconds = jobs.reduce((sum, job) => sum + job.seconds, 0);
      return {
        name: setup.name,
        seconds,
        duration: formatDurationSeconds(seconds),
        tools: rollUpTools(jobs),
        jobs,
      };
    });

    const tools: ToolTiming[] = rollUpTools(
      setupTimings.flatMap((setup) => setup.jobs),
    ).map((tool) => ({
      ...tool,
      declaredWorkTime: declaredToolTimes.get(tool.tool),
    }));

    const seconds = setupTimings.reduce((sum, setup) => sum + setup.seconds, 0);

    return {
      seconds,
      duration: formatDurationSeconds(seconds),
      setups: setupTimings,
      tools,
    };
  };

  return { push, finish };
}

export function extractTimingReport(events: Iterable<EventData>): TimingReport {
  return runConsumer(createTimingConsumer(), events);
}
