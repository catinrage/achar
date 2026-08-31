import type { EventData } from '../parser';

/**
 * What the trace says a program is supposed to do.
 *
 * This is the first of the verifier's two derivations. It reads only the
 * trace — never the post, never the post's state — and answers, per job
 * instance: which tool, at what speed, between which planes, at what angle.
 * The second derivation reads the emitted G-code. Comparing them is the
 * whole idea, and it only means something because neither one can see the
 * other's reasoning.
 */

export interface DrillIntent {
  cycleName: string;
  /**
   * The planes the cycle call must carry, already resolved.
   *
   * These are not the raw trace fields. `@drill` opens with
   * `drill_upper_z = drill_upper_z - safety`, mutating the value before any
   * cycle is written, and SolidCAM supplies `cycle_*_precise` overrides when
   * it has them. The authority for that arithmetic is the GPP source, read
   * directly — not achar, which must be free to disagree.
   */
  clearanceZ: number;
  upperZ: number;
  lowerZ: number;
  pointCount: number;
}

export interface JobIntent {
  /** Position in the trace's job order, which is also the EXTCALL order. */
  index: number;
  jobName: string;
  originalJobName: string;
  jobType: string;
  /** The subprogram legacy writes for this job: `-` becomes `_`. */
  fileName: string;
  /**
   * The tool this job must cut with.
   *
   * A job announces a change only when the tool differs from the one already
   * loaded, so the tool for a job is the one named by the most recent
   * `ChangeTool` — read straight off the trace, not resolved through any
   * post's latch.
   */
  toolId?: string;
  toolNumber?: number;
  spinRate: number;
  clearancePlane: number;
  upperPlane: number;
  lowerPlane: number;
  safety: number;
  startPosition: { x?: number; y?: number; z?: number; a?: number };
  transform4x: boolean;
  transformTranslate: boolean;
  floodCoolant: boolean;
  isDrillJob: boolean;
  drills: DrillIntent[];
  /**
   * Every spindle speed the trace commands during this job.
   *
   * A job does not cut at one speed: `spin_rate` is the nominal, `finish_spin`
   * covers the finishing pass, and iMachining ramps through a series of
   * `m_feed_spin` events. What matters is that the speed a line cuts at was
   * asked for by *something* in the trace, not that it equals any one field.
   */
  commandedSpeeds: number[];
  /** True when this instance announced its own tool change. */
  announcedToolChange: boolean;
}

export interface ProgramIntent {
  partName?: string;
  programName?: string;
  jobs: JobIntent[];
  /** Every tool the trace defines, by id string. */
  tools: Map<string, { number?: number; message?: string }>;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** SolidCAM's flag fields arrive as 0/1 numbers or as booleans. */
function flag(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

/**
 * The subprogram name legacy derives from a job name.
 *
 * `@start_of_job` computes `replace(job_name, '-', '_', 10)`, so a job called
 * `F-contour2` writes `F_contour2.SPF`. Reproducing one string substitution is
 * not "sharing the post's reasoning" — it is reading the trace's own naming.
 */
export function jobFileName(jobName: string): string {
  return jobName.replace(/-/g, '_');
}

export function deriveIntent(events: EventData[]): ProgramIntent {
  const jobs: JobIntent[] = [];
  const tools = new Map<string, { number?: number; message?: string }>();

  let partName: string | undefined;
  let programName: string | undefined;
  let lastTool: { id?: string; number?: number } = {};
  let announcedSinceJob = false;
  let current: JobIntent | undefined;
  let currentDrill: DrillIntent | undefined;

  for (const event of events) {
    switch (event._eventName) {
      case 'StartOfFile': {
        partName = text(event.part_name);
        programName = text(event.g_file_name);
        break;
      }

      case 'DefTool': {
        const id = text(event.tool_id_string);
        if (id) {
          tools.set(id, {
            number: number(event.tool_number),
            message: text(event.tool_message),
          });
        }
        break;
      }

      case 'ChangeTool': {
        lastTool = {
          id: text(event.tool_id_string) ?? lastTool.id,
          number: number(event.tool_number) ?? lastTool.number,
        };
        announcedSinceJob = true;
        break;
      }

      case 'StartOfJob': {
        const jobName = text(event.job_name) ?? `job_${jobs.length + 1}`;
        const jobType = text(event.job_type) ?? '';
        current = {
          index: jobs.length,
          jobName,
          originalJobName: text(event.original_job_name) ?? jobName,
          jobType,
          fileName: `${jobFileName(jobName)}.SPF`,
          toolId: lastTool.id,
          toolNumber: lastTool.number,
          spinRate: number(event.spin_rate) ?? 0,
          clearancePlane: number(event.job_clearance_plane) ?? 0,
          upperPlane: number(event.job_upper_plane) ?? 0,
          lowerPlane: number(event.job_lower_plane) ?? 0,
          safety: number(event.safety) ?? 0,
          startPosition: {
            x: number(event.xnext),
            y: number(event.ynext),
            z: number(event.znext),
            a: number(event.anext),
          },
          transform4x: flag(event.used_in_transform_4x),
          transformTranslate: flag(event.used_in_transform_translate),
          floodCoolant: isCoolantOn(event.flood_coolant),
          isDrillJob: jobType.toLowerCase().includes('drill'),
          drills: [],
          commandedSpeeds: [
            number(event.spin_rate),
            number(event.finish_spin),
            number(event.max_spin),
          ].filter((speed): speed is number => speed !== undefined),
          announcedToolChange: announcedSinceJob,
        };
        jobs.push(current);
        announcedSinceJob = false;
        currentDrill = undefined;
        break;
      }

      case 'Drill': {
        if (!current) break;
        const upper = number(event.drill_upper_z);
        currentDrill = {
          cycleName: text(event.drill_cycle_name) ?? '',
          clearanceZ:
            number(event.cycle_clearance_z_precise) ?? current.clearancePlane,
          upperZ:
            number(event.cycle_upper_z_precise) ??
            (upper === undefined ? 0 : upper - current.safety),
          lowerZ:
            number(event.cycle_lower_z_precise) ??
            number(event.drill_lower_z) ??
            0,
          pointCount: 0,
        };
        current.drills.push(currentDrill);
        const spin = number(event.spin);
        if (spin !== undefined) current.commandedSpeeds.push(spin);
        break;
      }

      case 'MFeedSpin': {
        const spin = number(event.spin);
        if (current && spin !== undefined) current.commandedSpeeds.push(spin);
        break;
      }

      case 'DrillPoint': {
        if (currentDrill) currentDrill.pointCount += 1;
        break;
      }

      case 'EndDrill': {
        currentDrill = undefined;
        break;
      }

      case 'EndOfJob': {
        current = undefined;
        currentDrill = undefined;
        break;
      }

      default:
        break;
    }
  }

  return { partName, programName, jobs, tools };
}

/**
 * Whether a coolant field means "on".
 *
 * SolidCAM writes these as enum-ish strings; anything that is not an explicit
 * off is treated as unset rather than on, so a field this verifier has not
 * seen before produces no finding instead of a false one.
 */
function isCoolantOn(value: unknown): boolean {
  const raw = text(value)?.toLowerCase();
  if (raw === undefined) return false;
  return raw === 'on' || raw === 'st_on' || raw === '1' || raw === 'true';
}
