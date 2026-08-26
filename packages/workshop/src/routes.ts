import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { listBuiltinPosts, machineFeatureSchema } from '@achar/core';
import type { Route, RouteContext } from '@achar/server';
import {
  attachment,
  badRequest,
  bytes,
  json,
  notFound,
  spoolToFile,
} from '@achar/server';
import type { WorkshopServices } from './context';
import { jobDirectory, jobOutputDirectory, traceFilePath } from './data/paths';
import type { TraceRecord } from './data/store';
import { describeJob } from './jobs/runner';
import {
  createMachine,
  deleteMachine,
  summarizeMachine,
  updateMachine,
} from './machines';
import { createZip } from './zip';

/**
 * The browser-facing API behind the workshop UI.
 *
 * Separate from `/v1` on purpose, and now in a separate package. `/v1` is a
 * stable contract another application depends on — Oracle parses its responses
 * through a schema — and it is stateless by design. These routes are the
 * opposite on both counts: they are free to change with the UI they serve, and
 * they are all about state that outlives a request.
 */

const MAX_RECENT_JOBS = 100;
const DEFAULT_RECENT_JOBS = 25;
/** A trace with more setups than this is not a part anyone hand-picks from. */
const MAX_SETUP_INDEX = 999;

export const workshopRoutes: Array<Route<WorkshopServices>> = [
  {
    method: 'GET',
    path: '/api/posts',
    gated: false,
    handle: () =>
      json({
        posts: listBuiltinPosts().map((post) => ({
          id: post.id,
          name: post.name,
          // The form fills the profile's `controller` in from the post rather
          // than asking: the two must agree or generation is refused, and a
          // field whose only correct value is already known is a field that
          // can only be got wrong.
          controller: post.controller,
          dialects: post.dialects,
        })),
        // The machine form renders its feature inputs from this rather than
        // hard-coding them, so a new property reaches the UI with the row
        // that declares it.
        machineFeatures: machineFeatureSchema(),
      }),
  },

  // ---- machines ---------------------------------------------------------

  {
    method: 'GET',
    path: '/api/machines',
    gated: false,
    handle: ({ services }) =>
      json({ machines: services.store.listMachines().map(summarizeMachine) }),
  },
  {
    method: 'POST',
    path: '/api/machines',
    gated: false,
    handle: async ({ body, services }) => {
      const machine = await createMachine(services.store, services.paths, {
        name: body.option('name') ?? '',
        postId: body.option('postId') ?? '',
        vmid: body.part('vmid'),
        machineProfile: body.part('machineProfile'),
      });
      return json({ machine }, 201);
    },
  },
  {
    method: 'PATCH',
    path: '/api/machines/:id',
    gated: false,
    handle: async ({ body, params, services }) => {
      const machine = await updateMachine(
        services.store,
        services.paths,
        params.id ?? '',
        {
          name: body.option('name'),
          postId: body.option('postId'),
          vmid: body.part('vmid'),
          machineProfile: body.part('machineProfile'),
          clearVmid: body.option('clearVmid') === 'true',
          clearProfile: body.option('clearProfile') === 'true',
        },
      );
      return json({ machine });
    },
  },
  {
    method: 'DELETE',
    path: '/api/machines/:id',
    gated: false,
    handle: async ({ params, services }) => {
      await deleteMachine(services.store, services.paths, params.id ?? '');
      return json({ deleted: params.id });
    },
  },

  // ---- traces -----------------------------------------------------------

  {
    method: 'POST',
    path: '/api/traces',
    gated: false,
    // The handler owns the request stream: the trace is written to the volume
    // as it arrives rather than buffered, so a queued upload costs disk, not
    // the memory the parse ahead of it is already competing for.
    streaming: true,
    handle: async (context) => uploadTrace(context),
  },
  {
    method: 'GET',
    path: '/api/traces/:sha',
    gated: false,
    handle: ({ params, services }) =>
      json({ trace: describeTrace(requireTrace(services, params.sha)) }),
  },

  // ---- jobs -------------------------------------------------------------

  {
    method: 'POST',
    path: '/api/jobs',
    gated: false,
    handle: async (context) => submitJob(context),
  },
  {
    method: 'GET',
    path: '/api/jobs',
    gated: false,
    handle: ({ body, services }) => {
      const limit = body.integerOption('limit', {
        fallback: DEFAULT_RECENT_JOBS,
        min: 1,
        max: MAX_RECENT_JOBS,
      });
      return json({
        jobs: services.store
          .listRecentJobs(limit)
          .map((job) => describeJob(services.store, job)),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/jobs/:id',
    gated: false,
    handle: ({ params, services }) =>
      json({
        job: describeJob(services.store, requireJob(services, params.id)),
      }),
  },
  {
    method: 'DELETE',
    path: '/api/jobs/:id',
    gated: false,
    handle: async ({ params, services }) => {
      const job = requireJob(services, params.id);

      // A job the queue still owns is not history yet. Deleting the row from
      // under a worker would leave it writing output into a directory nothing
      // refers to, and the operator watching a spinner would see it vanish
      // with no result either way. Removing it has to mean cancelling it, and
      // cancellation is a feature with its own questions — so this refuses
      // rather than half-implementing one.
      if (job.status === 'queued' || job.status === 'running') {
        throw badRequest(
          'This job has not finished yet. Wait for it to finish, then delete it.',
        );
      }

      // Order matters: the row goes first, so a failure to remove the
      // directory leaves orphaned bytes the retention sweep can be taught to
      // find, rather than a history entry whose files are already gone.
      services.store.deleteJob(job.id);
      await rm(jobDirectory(services.paths, job.id), {
        recursive: true,
        force: true,
      });

      return json({ deleted: job.id });
    },
  },
  {
    method: 'GET',
    path: '/api/jobs/:id/files/:name',
    gated: false,
    handle: async ({ params, services }) => {
      const job = requireJob(services, params.id);
      const name = requireFile(services, job.id, params.name);
      const file = Bun.file(
        path.join(jobOutputDirectory(services.paths, job.id), name),
      );
      if (!(await file.exists())) throw notFound();

      return {
        status: 200,
        body: await file.text(),
        contentType: 'text/plain; charset=utf-8',
        headers: attachment(name),
      };
    },
  },
  {
    method: 'GET',
    path: '/api/jobs/:id/trace',
    gated: false,
    handle: async ({ params, services }) => {
      const job = requireJob(services, params.id);
      // Retention deletes the upload long before the job row, so "gone" is a
      // normal outcome here and needs to say so rather than 404 like a typo.
      const trace = services.store.findTrace(job.traceSha256);
      if (trace === undefined || trace.purgedAt !== null) {
        throw badRequest(
          'The uploaded trace for this job has passed its retention window and been deleted.',
        );
      }

      const file = Bun.file(traceFilePath(services.paths, job.traceSha256));
      if (!(await file.exists())) throw notFound();

      return {
        status: 200,
        // Streamed straight from the volume: these run to hundreds of
        // megabytes and must not be read into memory to be handed back.
        body: file.stream(),
        contentType: 'application/octet-stream',
        headers: {
          ...attachment(job.traceName),
          'content-length': String(job.traceBytes),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/jobs/:id/archive',
    gated: false,
    handle: async ({ params, services }) => {
      const job = requireJob(services, params.id);
      const files = services.store.listFiles(job.id);
      if (files.length === 0) {
        throw badRequest('This job produced no files to download.');
      }

      const directory = jobOutputDirectory(services.paths, job.id);
      const entries = [];
      for (const file of files) {
        entries.push({
          name: file.name,
          data: new Uint8Array(
            await Bun.file(path.join(directory, file.name)).arrayBuffer(),
          ),
        });
      }

      const archive = createZip(entries);
      return bytes(
        archive,
        'application/zip',
        attachment(`${archiveName(job.traceName)}.zip`),
      );
    },
  },
];

/**
 * Accepts an upload and analyses it.
 *
 * The upload is not a job. An operator cannot say which setups to post until
 * something has read the file, and the same file is routinely posted again
 * for another machine or another setup — so the trace is stored once by
 * content hash, analysed once, and referenced by every job built from it.
 *
 * A file already on the volume is answered immediately with its stored
 * analysis: no parse, no queue, no second copy of a 300 MB upload.
 */
async function uploadTrace(context: RouteContext<WorkshopServices>) {
  const { services, url } = context;
  const name = url.searchParams.get('filename')?.trim() || 'trace.MPF';

  // Spooled under a scratch name first: the destination is the content hash,
  // which is not known until the last byte has arrived.
  const scratch = path.join(
    services.paths.spool,
    `upload-${Bun.randomUUIDv7()}`,
  );
  const upload = await spoolToFile(
    context.request,
    scratch,
    services.maxBodyBytes,
  );

  const destination = traceFilePath(services.paths, upload.sha256);
  const known = services.store.findTrace(upload.sha256);
  // A row is not enough: retention deletes the file and leaves the analysis,
  // and a failed one has nothing worth reusing.
  const reusable =
    known !== undefined &&
    known.purgedAt === null &&
    known.status !== 'failed' &&
    (await Bun.file(destination).exists());

  if (reusable) {
    // Identical bytes already on the volume. Keeping the second copy would
    // cost as much as the first and buy nothing.
    await Bun.file(scratch)
      .delete()
      .catch(() => {});
    services.store.touchTrace(upload.sha256, name);
    const trace = services.store.findTrace(upload.sha256);
    if (!trace) throw notFound();
    return json({ trace: describeTrace(trace), cached: true }, 200);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await rename(scratch, destination);

  services.store.createTrace({
    sha256: upload.sha256,
    name,
    bytes: upload.bytes,
  });
  services.runner.analyze(upload.sha256);

  const trace = services.store.findTrace(upload.sha256);
  if (!trace) throw notFound();
  return json({ trace: describeTrace(trace), cached: false }, 202);
}

/**
 * Queues generation for an already-uploaded trace.
 *
 * Returns `200` with an existing job when this exact combination has already
 * been posted, and `202` with a new one otherwise. Generation is
 * deterministic, so the cached answer is not merely equivalent — it is the
 * same bytes, which is the guarantee the whole service exists to provide.
 * The selection is part of that key: the same trace posted for setups 1,3 is
 * a different program from the same trace posted whole.
 */
async function submitJob(context: RouteContext<WorkshopServices>) {
  const { body, services } = context;

  const machineId = body.option('machineId');
  if (!machineId) {
    throw badRequest("A 'machineId' is required.");
  }
  const machine = services.store.findMachine(machineId);
  if (!machine) throw badRequest(`Unknown machine '${machineId}'.`);

  const traceSha = body.option('traceSha');
  if (!traceSha) {
    throw badRequest("A 'traceSha' is required. Upload the trace first.");
  }
  const trace = services.store.findTrace(traceSha);
  if (!trace) throw badRequest(`Unknown trace '${traceSha}'.`);
  if (trace.purgedAt !== null) {
    throw badRequest(
      'That upload has passed its retention window and been deleted. Upload the trace again.',
    );
  }
  if (trace.status !== 'ready') {
    throw badRequest(
      trace.status === 'analyzing'
        ? 'That upload is still being analysed.'
        : `That upload could not be analysed: ${trace.errorMessage ?? 'unknown error'}`,
    );
  }

  const programName = body.option('programName') ?? null;
  const setups = readSetupSelection(body.option('setups'), trace);
  const keepAllTools = body.option('keepAllTools') === 'true';

  // `machineRevision` is what makes this a cache of *configurations* rather
  // than of machine names: edit the machine and every job posted against the
  // version before the edit stops answering for it.
  const key = {
    traceSha256: traceSha,
    machineId,
    machineRevision: machine.revision,
    programName,
    setups,
    keepAllTools,
  };
  const cached = services.store.findCachedJob(key);
  if (cached) {
    return json(
      { job: describeJob(services.store, cached), cached: true },
      200,
    );
  }

  const jobId = Bun.randomUUIDv7();
  services.store.createJob({
    id: jobId,
    traceSha256: traceSha,
    traceName: trace.name,
    traceBytes: trace.bytes,
    machineId,
    machineRevision: machine.revision,
    programName,
    setups,
    keepAllTools,
  });
  services.runner.submit(jobId);

  const job = services.store.findJob(jobId);
  if (!job) throw notFound();
  return json({ job: describeJob(services.store, job), cached: false }, 202);
}

/**
 * Reads a `1,3` selection into the canonical form the cache key uses.
 *
 * Indices only, and every one is checked against the setups the analysis
 * actually found: a selection the trace cannot honour must fail here, on the
 * request that named it, rather than fifteen seconds later as a failed job
 * whose error nobody connects to a checkbox.
 *
 * Selecting every setup is stored as "the whole part" rather than as an
 * explicit list, so ticking all the boxes and ticking none produce the same
 * job — and, crucially, the same bytes as before this feature existed.
 */
function readSetupSelection(
  raw: string | undefined,
  trace: TraceRecord,
): string | null {
  if (raw === undefined) return null;

  const available = (parseJson(trace.setups) ?? []) as Array<{
    index: number;
  }>;
  const indices = new Set<number>();

  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;

    const index = Number(trimmed);
    if (!Number.isInteger(index) || index < 1 || index > MAX_SETUP_INDEX) {
      throw badRequest(
        `'${trimmed}' is not a setup index. Select setups by the number the trace analysis reported.`,
      );
    }
    if (!available.some((setup) => setup.index === index)) {
      throw badRequest(
        `This trace has no setup ${index}. It has ${available.length} setup(s).`,
      );
    }
    indices.add(index);
  }

  if (indices.size === 0) {
    throw badRequest('Select at least one setup, or omit the selection.');
  }
  if (indices.size === available.length) return null;

  return [...indices].sort((left, right) => left - right).join(',');
}

/** The trace as the browser reads it. */
function describeTrace(trace: TraceRecord) {
  return {
    sha256: trace.sha256,
    name: trace.name,
    bytes: trace.bytes,
    status: trace.status,
    setups: parseJson(trace.setups) ?? [],
    hasImplicitSetup: trace.hasImplicitSetup,
    timing: parseJson(trace.timing),
    profile: parseJson(trace.profile),
    diagnostics: parseJson(trace.diagnostics) ?? [],
    eventCount: trace.eventCount,
    error: trace.errorMessage,
    purged: trace.purgedAt !== null,
    createdAt: trace.createdAt,
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

function requireTrace(services: WorkshopServices, sha: string | undefined) {
  const trace = sha ? services.store.findTrace(sha) : undefined;
  if (!trace) throw notFound();
  return trace;
}

function requireJob(services: WorkshopServices, id: string | undefined) {
  const job = id ? services.store.findJob(id) : undefined;
  if (!job) throw notFound();
  return job;
}

/**
 * Resolves a download name against the job's recorded output.
 *
 * The name comes off the URL, so it is never joined to a path until it has
 * been matched against a row this job actually produced. That makes traversal
 * impossible without a separate check for it.
 */
function requireFile(
  services: WorkshopServices,
  jobId: string,
  requested: string | undefined,
): string {
  const name = requested ? decodeURIComponent(requested) : '';
  const match = services.store
    .listFiles(jobId)
    .find((file) => file.name === name);
  if (!match) throw notFound();
  return match.name;
}

/** A ZIP name derived from the uploaded trace, without its extension. */
function archiveName(traceName: string): string {
  const base = traceName.replace(/\.[^.]+$/, '').trim();
  return base.length > 0 ? base : 'achar-output';
}
