import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  parseMachineProfile,
  RENAMED_SIEMENS_828D_DIALECT_IDS,
} from '@achar/core';
import { messageOf } from '../kernel/errors';
import type { DataPaths } from './data/paths';
import { legacyJobTracePath, traceFilePath } from './data/paths';
import type { JobStore } from './data/store';
import { machineDirectory } from './machines';

/**
 * What a database written by an earlier version needs before it can be served.
 *
 * Column-level changes are replayed by the store itself; these are the ones
 * that also have to move bytes on the volume, which the store deliberately
 * cannot reach. Both are idempotent — they look for work and do nothing when
 * there is none — because they run on every start, and a migration that has
 * to be run exactly once is a migration that will be run twice.
 */
export async function migrateWorkshopData(
  store: JobStore,
  paths: DataPaths,
): Promise<void> {
  await migrateMachineProfiles(store, paths);
  migrateRenamedDialectIds(store);
  await migrateLegacyTraces(store, paths);
}

/**
 * Rewrites machine profiles that still name a dialect by its old id.
 *
 * The rename is not cosmetic: `resolveSiemens828dDialect` refuses an id it
 * does not know, so a machine left naming `poyakar-1160l` would stop posting
 * rather than post differently. Doing it here means a shop upgrades without
 * opening every machine to re-pick a value it never chose to change.
 *
 * Only the `dialect` field is touched, and only when its value is one of the
 * known renames — a profile naming something else is left exactly as it is
 * for the resolver to reject, because guessing at an unrecognised dialect is
 * how a job gets posted with the wrong output convention.
 */
function migrateRenamedDialectIds(store: JobStore): number {
  let rewritten = 0;

  for (const machine of store.listMachines()) {
    if (!machine.profile) continue;

    try {
      const profile = JSON.parse(machine.profile) as Record<string, unknown>;
      const current = profile.dialect;
      if (typeof current !== 'string') continue;

      const renamed = RENAMED_SIEMENS_828D_DIALECT_IDS[current];
      if (!renamed) continue;

      store.upsertMachine({
        ...machine,
        profile: JSON.stringify({ ...profile, dialect: renamed }, null, 2),
      });
      rewritten += 1;
    } catch (error) {
      console.error(
        `[achar] could not update the dialect for machine ${machine.id}: ${messageOf(error)}`,
      );
    }
  }

  if (rewritten > 0) {
    console.log(
      `[achar] renamed the dialect on ${rewritten} machine profile(s)`,
    );
  }
  return rewritten;
}

/**
 * Moves profiles that still live in `machines/<id>/machine.json` into the
 * database.
 *
 * A profile in two places is a profile that can disagree with itself, so the
 * file is deleted as soon as its content is safely in the column. Anything
 * unreadable is left alone and reported: losing a machine's configuration to
 * a migration is far worse than running one more startup with it in the old
 * place.
 */
async function migrateMachineProfiles(
  store: JobStore,
  paths: DataPaths,
): Promise<number> {
  let moved = 0;

  for (const pending of store.listMachinesWithProfileFiles()) {
    const machine = store.findMachine(pending.id);
    if (!machine) continue;

    const file = path.join(machineDirectory(paths, pending.id), pending.file);
    try {
      const source = await Bun.file(file).text();
      // Parsed, not trusted: a file that cannot be parsed must not become a
      // column every later read assumes is valid.
      parseMachineProfile(JSON.parse(source), `machine ${pending.id}`);
      store.upsertMachine({ ...machine, profile: source });
      await rm(file, { force: true });
      moved += 1;
    } catch (error) {
      console.error(
        `[achar] could not migrate the profile for machine ${pending.id}: ${messageOf(error)}`,
      );
    }
  }

  if (moved > 0) {
    console.log(`[achar] moved ${moved} machine profile(s) into the database`);
  }
  return moved;
}

/**
 * Moves traces uploaded under a job id into the content-addressed store.
 *
 * Uploads used to belong to a job — `jobs/<id>/trace.MPF` — and would
 * otherwise sit on the volume forever: the retention sweep now only looks at
 * trace rows, and there would be no row to find them by. Each one becomes a
 * row keyed by the hash the job already recorded, back-dated to the job's own
 * timestamp so it expires on the schedule it was always going to.
 *
 * The rows are marked ready with no analysis rather than queued for one: a
 * deployment with two hundred jobs would otherwise spend its first minutes
 * re-parsing every trace anyone ever uploaded. What that costs is a setup list
 * for old uploads, which nobody could see before this version either.
 */
async function migrateLegacyTraces(
  store: JobStore,
  paths: DataPaths,
): Promise<number> {
  let moved = 0;

  for (const job of store.listJobsWithTraceCandidates()) {
    const source = legacyJobTracePath(paths, job.id);
    if (!(await Bun.file(source).exists())) continue;

    const destination = traceFilePath(paths, job.traceSha256);
    try {
      if (await Bun.file(destination).exists()) {
        // Two jobs from the same file: the first one moved it, and a second
        // copy of a trace this size is exactly what content addressing is for.
        await rm(source, { force: true });
      } else {
        await mkdir(path.dirname(destination), { recursive: true });
        await rename(source, destination);
      }
      store.adoptTrace({
        sha256: job.traceSha256,
        name: job.traceName,
        bytes: job.traceBytes,
        createdAt: job.createdAt,
      });
      moved += 1;
    } catch (error) {
      console.error(
        `[achar] could not migrate the trace for job ${job.id}: ${messageOf(error)}`,
      );
    }
  }

  if (moved > 0) {
    console.log(
      `[achar] moved ${moved} uploaded trace(s) into the trace store`,
    );
  }
  return moved;
}
