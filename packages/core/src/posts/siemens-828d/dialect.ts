/**
 * Output dialects for the Siemens 828D post.
 *
 * A dialect is *how the G-code text is written*: which words are printed,
 * in what order, and when a modal value is repeated. It is a property of the
 * legacy GPP that a shop's output is being matched against, not of any
 * machine standing on the floor. Two 828D machines wired identically produce
 * different files if they were posted by different GPPs, and one machine
 * produces the same file no matter which of its spindles is turning.
 *
 * That is why dialects live here, in code, rather than in machine profiles.
 * There are a handful of them, each one is derived from reading a GPP source
 * and proven against a fixture, and adding one is a reviewed change. A
 * machine profile only *names* the dialect it needs — see `MachineProfile.dialect`.
 *
 * The counterpart is `MachineProfileFeatures`, which holds what a machinist
 * could point at: whether the machine has a tool probe, how long its coolant
 * takes to come up to pressure. Those vary per machine and belong in data.
 *
 * Every field is required. A dialect is a complete description of an output
 * convention, so there is no such thing as a partially specified one, and no
 * read site has to know what a missing value would have meant.
 */
export interface Siemens828dDialect {
  /**
   * Emit the drill approach Z before coolant-on when the trace flags it
   * changed, even if a preceding rapid already positioned there.
   * Never applies to CYCLE84 — see gpp-semantics rule 8.
   */
  drillApproachZBeforeCoolant: boolean;
  /**
   * Treat coolant as still running across a job boundary, suppressing the
   * repeated coolant-on block that would otherwise open the next job.
   */
  retainCoolantAcrossJobs: boolean;
  /** Emit `CANCEL(1..3)` cleanup before `M9` when a job used air coolant. */
  cancelAirCoolantSchedule: boolean;
  /**
   * Print `F` whenever the trace's raw `feed__changed` bit is set, rather than
   * only on a numeric change against the previous line's feed.
   * This is the two-GPP split documented in gpp-semantics rule 11.
   */
  lineFeedFromChangeFlag: boolean;
  /** Let an arc's feed become the modal feed that suppresses the next `F`. */
  trackArcFeedRate: boolean;
  /** Emit an inline `G94` on the first feed move of a job. */
  inlineFeedRateMode: boolean;
  /** Round coordinates through the post formatter before emitting them. */
  compactCoordinates: boolean;
  /** Emit the `Tools Used In This Program` comment block in the main file. */
  mainToolListComments: boolean;
  /** Repeat the first approach XY after the first job-start Z move. */
  forceInitialApproachPosition: boolean;
  /** Write the tool measurement program after the main program, so it does
   *  not consume the main program's early N-numbers. */
  toolMeasurementProgramDeferred: boolean;
  /**
   * Emit a job's start position block only when the job also changes tool.
   *
   * Previously inferred from *whether a machine profile was supplied at all*,
   * which silently made "has a profile" mean "posts like a PoyaKar". It is a
   * dialect trait and now says so.
   */
  startPositionRequiresToolChange: boolean;
}

/**
 * The stock `Siemens_828D_Milling_4A.gpp` conventions.
 *
 * These values are the defaults the post used before dialects existed, so a
 * machine that names no dialect keeps posting exactly as it did.
 */
export const SIEMENS_828D_STOCK_DIALECT: Siemens828dDialect = {
  drillApproachZBeforeCoolant: false,
  retainCoolantAcrossJobs: false,
  cancelAirCoolantSchedule: true,
  lineFeedFromChangeFlag: false,
  trackArcFeedRate: false,
  inlineFeedRateMode: true,
  compactCoordinates: false,
  mainToolListComments: false,
  forceInitialApproachPosition: false,
  toolMeasurementProgramDeferred: false,
  startPositionRequiresToolChange: false,
};

/**
 * The `PoyaKar_1160L_3A.gpp` conventions.
 *
 * Proven against the `567` and `AG_BIG_SABET` fixtures. Every deviation from
 * stock here was root-caused against one of the two GPP sources rather than
 * guessed; see docs/gpp-semantics.md rules 8-11.
 */
export const POYAKAR_1160L_DIALECT: Siemens828dDialect = {
  drillApproachZBeforeCoolant: true,
  retainCoolantAcrossJobs: true,
  cancelAirCoolantSchedule: false,
  lineFeedFromChangeFlag: true,
  trackArcFeedRate: true,
  inlineFeedRateMode: false,
  compactCoordinates: true,
  mainToolListComments: true,
  forceInitialApproachPosition: true,
  toolMeasurementProgramDeferred: true,
  startPositionRequiresToolChange: true,
};

export const SIEMENS_828D_DIALECTS: Readonly<
  Record<string, Siemens828dDialect>
> = {
  'siemens-828d': SIEMENS_828D_STOCK_DIALECT,
  'poyakar-1160l': POYAKAR_1160L_DIALECT,
};

export const DEFAULT_SIEMENS_828D_DIALECT_ID = 'siemens-828d';

export function listSiemens828dDialectIds(): string[] {
  return Object.keys(SIEMENS_828D_DIALECTS);
}

/**
 * Looks up a dialect by id, falling back to stock when none is named.
 *
 * An unknown id throws rather than falling back. Silently posting a job with
 * the wrong output convention is the exact failure this whole mechanism
 * exists to prevent, and a typo in a profile must not produce a plausible
 * file that is wrong in a dozen scattered places.
 */
export function resolveSiemens828dDialect(id?: string): Siemens828dDialect {
  if (id === undefined) return SIEMENS_828D_STOCK_DIALECT;

  const dialect = SIEMENS_828D_DIALECTS[id];
  if (!dialect) {
    throw new Error(
      `Unknown Siemens 828D dialect '${id}'. Available dialects: ${listSiemens828dDialectIds().join(', ')}.`,
    );
  }
  return dialect;
}
