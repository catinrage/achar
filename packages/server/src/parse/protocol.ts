import type {
  CompareOptions,
  GeneratedFile,
  ProductProfile,
  SetupOverview,
  TimingReport,
} from '@achar/core';

/**
 * Message contract between the HTTP thread and a parse worker.
 *
 * Traces cross this boundary as **file paths**, never as strings. A 311 MB
 * trace structured-cloned into a worker would be copied in full before any
 * work started; handing over a path costs nothing and lets the worker read it
 * with the same streaming primitives the upload used.
 */

/** Documents supplied as content rather than paths. These are all small. */
interface TaskDocuments {
  vmid?: string;
  machineProfile?: string;
}

interface TaskOptions {
  postId?: string;
  programName?: string;
}

/**
 * Which setups to post, as 1-based indices.
 *
 * Indices rather than the CLI's `1-3,Setup2` spec: resolving names and ranges
 * needs the trace's spans, which only exist after a parse, so a caller that has
 * not parsed yet could not be told its selection was wrong. The workshop lists
 * the setups from a prior analysis and sends back the indices it showed.
 */
interface SetupSelection {
  setups?: number[];
  /** Keep tool definitions no selected setup loads. Defaults to false. */
  keepAllTools?: boolean;
}

interface BaseTask extends TaskDocuments, TaskOptions {
  tracePath: string;
}

export type WorkerTask =
  | ({ op: 'profile' } & BaseTask)
  | ({ op: 'timing' } & BaseTask)
  | ({ op: 'validate' } & BaseTask)
  | ({ op: 'generate' } & BaseTask)
  | ({ op: 'explain'; file?: string; event?: string } & BaseTask)
  | ({
      op: 'parity';
      reference: GeneratedFile[];
      compare: CompareOptions;
    } & BaseTask)
  | ({ op: 'parse'; event?: string; offset: number; limit: number } & BaseTask)
  /**
   * Everything about a trace that does not depend on a machine.
   *
   * The setup list, the cycle time and the tool list all fall out of one
   * streamed pass, and none of them needs a VMID, a profile or a post. Split
   * from `bundle` because the workshop shows them *before* the operator has
   * chosen what to generate — the setup indices this returns are what a later
   * `bundle` selection addresses.
   */
  | ({ op: 'analyze' } & BaseTask)
  /**
   * Generate, timing and product profile from a single parse.
   *
   * The parse is ~97% of the cost, so the two extra extractions add well under
   * a second to a job measured in tens. Callers that need all three — the
   * workshop's results page does — would otherwise pay for three parses.
   */
  | ({ op: 'bundle' } & SetupSelection & BaseTask);

/**
 * A failure the caller is responsible for, carried across the boundary.
 *
 * `HttpError` cannot survive a structured clone as itself, so its status and
 * code travel as data and the pool rebuilds the error on the other side.
 */
export interface TaskFailure {
  status: number;
  code: string;
  message: string;
}

export type WorkerResponse =
  | { ok: true; value: unknown; durationMs: number }
  | { ok: false; failure: TaskFailure };

/** A generated file, returned rather than written. */
export interface BundledFile {
  name: string;
  code: string;
  bytes: number;
  lines: number;
}

/**
 * What the `bundle` op reports back.
 *
 * Files come back as data so the worker touches nothing but the trace it was
 * given to read. Deciding where output belongs — and whether it is kept at all
 * — is the caller's business, not the parser's.
 */
export interface BundleOutcome {
  files: BundledFile[];
  diagnostics: unknown;
  timing: unknown;
  profile: unknown;
  programName: string;
  eventCount: number;
  /** Set when error-severity diagnostics stopped generation. */
  blocked: boolean;
  /** The setups this program covers, or null when it covers the whole part. */
  selectedSetups: SetupOverview[] | null;
}

/** What the `analyze` op reports back. */
export interface AnalyzeOutcome {
  eventCount: number;
  /** Every setup in the trace, in program order. Empty for a trace with none. */
  setups: SetupOverview[];
  /**
   * True when jobs run before the first `@setup`. Those belong to the shared
   * prologue and are posted with every selection, so the UI has to say so
   * rather than let an operator believe a selection excluded them.
   */
  hasImplicitSetup: boolean;
  timing: TimingReport | null;
  profile: ProductProfile | null;
  /**
   * Findings that belong to the trace itself rather than to any machine —
   * `no-timing-data` above all. Machine-dependent diagnostics stay on the job.
   */
  diagnostics: unknown;
}
