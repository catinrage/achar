import path from 'node:path';
import { listBuiltinPosts } from '@achar/core';
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
import { jobOutputDirectory, jobTracePath } from './data/paths';
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
        })),
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

  // ---- jobs -------------------------------------------------------------

  {
    method: 'POST',
    path: '/api/jobs',
    gated: false,
    // The handler owns the request stream: the trace is written to the volume
    // as it arrives rather than buffered, so a queued upload costs disk, not
    // the memory the parse ahead of it is already competing for.
    streaming: true,
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
      if (job.tracePurgedAt !== null) {
        throw badRequest(
          'The uploaded trace for this job has passed its retention window and been deleted.',
        );
      }

      const file = Bun.file(jobTracePath(services.paths, job.id));
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
 * Accepts an upload and queues it.
 *
 * Returns `200` with an existing job when this exact trace has already been
 * posted for this machine, and `202` with a new one otherwise. Generation is
 * deterministic, so the cached answer is not merely equivalent — it is the
 * same bytes, which is the guarantee the whole service exists to provide.
 */
async function submitJob(context: RouteContext<WorkshopServices>) {
  const { services, url } = context;
  const machineId = url.searchParams.get('machineId')?.trim();
  if (!machineId) {
    throw badRequest("A 'machineId' query parameter is required.");
  }
  const machine = services.store.findMachine(machineId);
  if (!machine) throw badRequest(`Unknown machine '${machineId}'.`);

  const programName = url.searchParams.get('programName')?.trim() || null;
  const traceName = url.searchParams.get('filename')?.trim() || 'trace.MPF';

  const jobId = Bun.randomUUIDv7();
  const upload = await spoolToFile(
    context.request,
    jobTracePath(services.paths, jobId),
    services.maxBodyBytes,
  );

  const cached = services.store.findCachedJob(upload.sha256, machineId);
  if (cached && cached.programName === programName) {
    // The upload is already on disk under a job id that will never be used.
    // Dropping it now keeps the volume free of duplicates of the largest
    // files the service handles.
    await Bun.file(upload.path)
      .delete()
      .catch(() => {});
    return json(
      { job: describeJob(services.store, cached), cached: true },
      200,
    );
  }

  services.store.createJob({
    id: jobId,
    traceSha256: upload.sha256,
    traceName,
    traceBytes: upload.bytes,
    machineId,
    programName,
  });
  services.runner.submit(jobId);

  const job = services.store.findJob(jobId);
  if (!job) throw notFound();
  return json({ job: describeJob(services.store, job), cached: false }, 202);
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
