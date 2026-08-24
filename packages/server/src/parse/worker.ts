import {
  compareGeneratedFiles,
  extractProductProfile,
  extractTimingReport,
  Logger,
  summarizeCompareResults,
  ValidationError,
} from '@achar/core';
import { HttpError, messageOf, unprocessableTrace } from '../errors';
import {
  buildProgramFrom,
  hasErrorDiagnostics,
  loadTraceInputsFrom,
  parseTrace,
} from '../inputs';
import type { BundleOutcome, WorkerResponse, WorkerTask } from './protocol';

/**
 * Parse worker.
 *
 * Every trace-reading operation runs here rather than on the HTTP thread.
 * `Parser.parse()` is synchronous and, on a 311 MB trace, holds the thread for
 * ten to fifteen seconds — long enough that `/health` times out and every
 * other caller, Oracle included, is stalled behind a single upload. Moving the
 * work off-thread is what makes one shared service viable.
 *
 * One worker handles exactly one task and then exits. That is deliberate: the
 * parser allocates a line array and an event object per event, and JSC grows
 * its heap to the high-water mark of everything it has ever done. Measured
 * across six identical 311 MB parses in one long-lived process, peak RSS
 * climbed 1.5 GB -> 5.2 GB even though nothing leaked. A process per task
 * hands the memory back to the OS every time, and an out-of-memory kill takes
 * the worker rather than the server.
 */

// The parser emits hundreds of "Unknown event type for validation" warnings
// per trace. Workers inherit none of the host's configuration, so this has to
// be set here as well as in the server.
Logger.setGlobalOptions({ enabled: false });

declare const self: Worker;

let replied = false;

/**
 * A post listener that throws can surface as an unhandled rejection rather
 * than through the `try` below, and an unhandled rejection ends the worker.
 * Without this the pool sees a thread that simply stopped and reports a
 * fragment of a stack trace; with it the caller gets a real message.
 */
process.on('unhandledRejection', (reason: unknown) => {
  reply({ ok: false, failure: toFailure(reason) });
});

self.onmessage = async (event: MessageEvent<WorkerTask>) => {
  const startedAt = performance.now();
  try {
    const value = await run(event.data);
    reply({ ok: true, value, durationMs: performance.now() - startedAt });
  } catch (error) {
    reply({ ok: false, failure: toFailure(error) });
  }
};

function reply(response: WorkerResponse): void {
  // One task per worker, so the first answer is the only answer; a late
  // unhandled rejection must not overwrite a result already sent.
  if (replied) return;
  replied = true;
  self.postMessage(response);
}

async function run(task: WorkerTask): Promise<unknown> {
  const trace = await Bun.file(task.tracePath).text();

  switch (task.op) {
    case 'profile':
      return analyze(() => extractProductProfile(parseTrace(trace)));

    case 'timing':
      return analyze(() => extractTimingReport(parseTrace(trace)));

    case 'parse': {
      const events = parseTrace(trace);
      const selected = task.event
        ? events.filter((candidate) => candidate._eventName === task.event)
        : events;
      return {
        events: selected.slice(task.offset, task.offset + task.limit),
        total: selected.length,
        offset: task.offset,
        limit: task.limit,
      };
    }

    case 'validate': {
      const inputs = loadTraceInputsFrom(
        { trace, ...documentsOf(task) },
        optionsOf(task).postId,
      );
      return {
        eventCount: inputs.events.length,
        durationMs: inputs.durationMs,
        diagnostics: inputs.diagnostics,
      };
    }

    case 'generate': {
      const inputs = loadTraceInputsFrom(
        { trace, ...documentsOf(task) },
        optionsOf(task).postId,
      );
      if (hasErrorDiagnostics(inputs.diagnostics)) return refusal(inputs);

      const files = buildProgramFrom(
        optionsOf(task),
        inputs,
      ).program.generate();
      return {
        files: files.map((file) => ({
          file: file.file,
          code: file.code,
          bytes: Buffer.byteLength(file.code, 'utf-8'),
          lines: file.code.split(/\r?\n/).length,
        })),
        eventCount: inputs.events.length,
        durationMs: inputs.durationMs,
        diagnostics: inputs.diagnostics,
      };
    }

    case 'explain': {
      const inputs = loadTraceInputsFrom(
        { trace, ...documentsOf(task) },
        optionsOf(task).postId,
      );
      if (hasErrorDiagnostics(inputs.diagnostics)) return refusal(inputs);

      const { program } = buildProgramFrom(optionsOf(task), inputs);
      return { text: program.explain({ file: task.file, event: task.event }) };
    }

    case 'parity': {
      const inputs = loadTraceInputsFrom(
        { trace, ...documentsOf(task) },
        optionsOf(task).postId,
      );
      if (hasErrorDiagnostics(inputs.diagnostics)) return refusal(inputs);

      const generated = buildProgramFrom(
        optionsOf(task),
        inputs,
      ).program.generate();
      const results = compareGeneratedFiles(
        generated,
        task.reference,
        task.compare,
      );
      return { results, summary: summarizeCompareResults(results) };
    }

    case 'bundle':
      return bundle(task, trace);
  }
}

/**
 * Generation, timing and the product profile off a single parse.
 *
 * The parse is ~97% of the cost, so the two extra extractions add roughly half
 * a second to a fifteen-second job — the reason a caller can show cycle time
 * and a tool list without asking for a second upload.
 */
function bundle(
  task: Extract<WorkerTask, { op: 'bundle' }>,
  trace: string,
): BundleOutcome {
  const inputs = loadTraceInputsFrom(
    { trace, ...documentsOf(task) },
    optionsOf(task).postId,
  );

  // Extracted before the blocked decision, because the profile carries
  // diagnostics of its own. `no-timing-data` in particular is error-severity
  // and lives only here — it is what `/v1/trace/profile` answers 422 on and
  // what Oracle branches on, so a job that ignored it would refuse work the
  // API accepts and accept work the API refuses.
  const timing = analyzeOrNull(() => extractTimingReport(inputs.events));
  const profile = analyzeOrNull(() => extractProductProfile(inputs.events));

  const diagnostics = [...inputs.diagnostics, ...(profile?.diagnostics ?? [])];
  const blocked = hasErrorDiagnostics(diagnostics);

  if (blocked) {
    return {
      files: [],
      diagnostics,
      timing,
      profile,
      programName: '',
      eventCount: inputs.events.length,
      blocked: true,
    };
  }

  const { program, programName } = buildProgramFrom(optionsOf(task), inputs);

  const files = program.generate().map((file) => ({
    name: file.file,
    code: file.code,
    bytes: Buffer.byteLength(file.code, 'utf-8'),
    lines: file.code.split(/\r?\n/).length,
  }));

  return {
    files,
    diagnostics,
    timing,
    profile,
    programName,
    eventCount: inputs.events.length,
    blocked: false,
  };
}

function documentsOf(task: WorkerTask) {
  return { vmid: task.vmid, machineProfile: task.machineProfile };
}

function optionsOf(task: WorkerTask) {
  return { postId: task.postId, programName: task.programName };
}

/** Mirrors `refuseOnErrors` in the route table: 422 with what was extracted. */
function refusal(inputs: ReturnType<typeof loadTraceInputsFrom>) {
  return {
    __refused: true,
    eventCount: inputs.events.length,
    durationMs: inputs.durationMs,
    diagnostics: inputs.diagnostics,
  };
}

/**
 * Runs a core extraction that can reject the trace on its own content.
 *
 * Only `ValidationError` is translated: it is core's way of saying the input
 * failed a stated rule, which for these operations can only be the posted
 * trace. Every other failure propagates and becomes a logged 500, so a genuine
 * bug is never dressed up as the caller's fault.
 */
function analyze<T>(extract: () => T): T {
  try {
    return extract();
  } catch (error) {
    if (error instanceof ValidationError) throw unprocessableTrace(error);
    throw error;
  }
}

/**
 * {@link analyze} for the supplementary extractions on a job, where a
 * self-contradicting trace should cost the reader that one panel rather than
 * the whole job — the G-code is the deliverable.
 */
function analyzeOrNull<T>(extract: () => T): T | null {
  try {
    return extract();
  } catch (error) {
    if (error instanceof ValidationError) return null;
    throw error;
  }
}

function toFailure(error: unknown) {
  if (error instanceof HttpError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  // Detail stays in the worker's own log; the caller gets nothing specific.
  console.error(`[achar:worker] unhandled error: ${messageOf(error)}`);
  return {
    status: 500,
    code: 'internal',
    message: 'An unexpected error occurred.',
  };
}
