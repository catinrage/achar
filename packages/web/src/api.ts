import { m } from './messages/fa';

/**
 * Client for the workshop API.
 *
 * The page is served by the same process that answers these calls, so every
 * request is same-origin and there is no base URL to configure.
 */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobFile {
  name: string;
  bytes: number;
  lines: number;
}

/**
 * A finding attached to a job.
 *
 * Core produces two structurally different diagnostics into one list, and the
 * UI has to render both. VMID and machine-profile checks report the trace
 * location (`event`, `key`) and carry no code; product-profile checks report a
 * stable `code` such as `no-timing-data` and carry no location. Every field
 * beyond `severity` and `message` is therefore optional.
 */
export interface Diagnostic {
  severity: 'warning' | 'error';
  message: string;
  code?: string;
  event?: string;
  key?: string;
}

export interface SetupToolTiming {
  tool: string;
  seconds: number;
  duration: string;
  jobInstances: number;
}

export interface JobTiming {
  name: string;
  tool?: string;
  instances: number;
  seconds: number;
  cuttingSeconds: number;
  linkingSeconds: number;
  duration: string;
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
  declaredWorkTime?: string;
}

export interface TimingReport {
  seconds: number;
  duration: string;
  setups: SetupTiming[];
  tools: ToolTiming[];
}

export interface ProductTool {
  toolIdString: string;
  name?: string;
  description?: string;
  type?: string;
  userType?: string;
  holderName?: string;
  diameter?: number;
  cornerRadius?: number;
  teethCount?: number;
  toolNumber?: number;
  duration: string;
  seconds: number;
  jobInstances: number;
}

export interface ProductProfile {
  part: {
    name?: string;
    materialName?: string;
    programNumber?: number;
    inchSystem?: boolean;
  };
  setups: SetupTiming[];
  tools: ProductTool[];
  totals: { seconds: number; duration: string };
  eventCount: number;
}

/** One setup, as the picker lists it. */
export interface SetupOverview {
  index: number;
  name: string;
  fixtureName?: string;
  partHomeNumber?: number;
  jobCount: number;
  seconds: number;
  duration: string;
}

export type TraceStatus = 'analyzing' | 'ready' | 'failed';

/**
 * An uploaded trace, before any machine is involved.
 *
 * The file is read once and the answers kept: which setups it contains, how
 * long each runs, which tools it uses. That is what the operator chooses from,
 * and none of it depends on which machine the program is eventually posted
 * for — so it is a resource of its own, addressed by content hash.
 */
export interface Trace {
  sha256: string;
  name: string;
  bytes: number;
  status: TraceStatus;
  setups: SetupOverview[];
  hasImplicitSetup: boolean;
  /** When the post stamped the trace; null when it carries no stamp. */
  postedAt: { raw: string; iso?: string } | null;
  timing: TimingReport | null;
  profile: ProductProfile | null;
  diagnostics: Diagnostic[];
  eventCount: number | null;
  error: string | null;
  purged: boolean;
  createdAt: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  position?: number;
  traceName: string;
  traceBytes: number;
  machineId: string;
  machineName: string | null;
  programName: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  files: JobFile[];
  diagnostics: Diagnostic[];
  timing: TimingReport | null;
  profile: ProductProfile | null;
  blocked: boolean;
  error: string | null;
  tracePurged: boolean;
  traceSha256: string;
  /** Selected setup indices, or null when the job covers the whole part. */
  setups: number[] | null;
  keepAllTools: boolean;
  selectedSetups: SetupOverview[] | null;
}

/** A machine profile, as the form edits it. */
export interface MachineProfile {
  id: string;
  name?: string;
  controller?: string;
  axes?: number;
  extends?: string;
  dialect?: string;
  features?: Record<string, boolean | number | string>;
  home?: MachineHome;
  returnHome?: MachineHome;
}

export interface MachineHome {
  x?: number;
  y?: number;
  z?: number;
}

export interface Machine {
  id: string;
  name: string;
  postId: string;
  postName: string;
  hasVmid: boolean;
  hasProfile: boolean;
  profile: MachineProfile | null;
}

export interface Post {
  id: string;
  name: string;
  controller: string;
  dialects: string[];
}

/**
 * One machine property, as core declares it.
 *
 * The form renders its inputs from this rather than hard-coding them, so a
 * property added to the core table reaches the UI with the row that declares
 * it — no form change, and no chance of the two disagreeing about a type.
 */
export type MachineFeatureSpec = {
  key: string;
  label: string;
  description: string;
} & (
  | { kind: 'boolean' }
  | {
      kind: 'number';
      min?: number;
      max?: number;
      integer?: boolean;
      unit?: string;
    }
  | { kind: 'enum'; values: string[] }
);

/**
 * An API failure carrying the server's own `code`.
 *
 * The code is what callers branch on; the message is already prose, but it is
 * English and developer-facing, so the UI maps the codes it knows about onto
 * Persian and keeps the raw message as detail.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string;

  constructor(status: number, code: string, detail: string) {
    super(translate(code, detail));
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function translate(code: string, detail: string): string {
  switch (code) {
    case 'body-too-large':
      return m.errorTooLarge;
    case 'busy':
      return 'سرویس در حال پردازش درخواست دیگری است. چند لحظه بعد دوباره تلاش کنید.';
    case 'parse-failed':
      return 'این فایل یک خروجی Trace 5 معتبر نیست.';
    case 'not-found':
      return 'مورد درخواستی یافت نشد.';
    default:
      return detail || m.errorGeneric;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new ApiError(0, 'network', m.errorNetwork);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } })
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? '',
    );
  }
  return body as T;
}

export const api = {
  listMachines: () =>
    request<{ machines: Machine[] }>('/api/machines').then((r) => r.machines),

  listPosts: () =>
    request<{ posts: Post[]; machineFeatures: MachineFeatureSpec[] }>(
      '/api/posts',
    ),

  createMachine: (form: FormData) =>
    request<{ machine: Machine }>('/api/machines', {
      method: 'POST',
      body: form,
    }).then((r) => r.machine),

  deleteMachine: (id: string) =>
    request<{ deleted: string }>(`/api/machines/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getTrace: (sha: string) =>
    request<{ trace: Trace }>(`/api/traces/${encodeURIComponent(sha)}`).then(
      (r) => r.trace,
    ),

  /** Queues generation for a trace that has already been analysed. */
  createJob: (options: {
    traceSha: string;
    machineId: string;
    programName?: string;
    setups?: number[];
    keepAllTools?: boolean;
  }) => {
    const query = new URLSearchParams({
      traceSha: options.traceSha,
      machineId: options.machineId,
    });
    if (options.programName) query.set('programName', options.programName);
    if (options.setups) query.set('setups', options.setups.join(','));
    if (options.keepAllTools) query.set('keepAllTools', 'true');

    return request<{ job: Job; cached: boolean }>(`/api/jobs?${query}`, {
      method: 'POST',
    });
  },

  listJobs: (limit = 25) =>
    request<{ jobs: Job[] }>(`/api/jobs?limit=${limit}`).then((r) => r.jobs),

  getJob: (id: string) =>
    request<{ job: Job }>(`/api/jobs/${encodeURIComponent(id)}`).then(
      (r) => r.job,
    ),

  /** Removes a finished job from history, output and all. */
  deleteJob: (id: string) =>
    request<{ deleted: string }>(`/api/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  fileUrl: (jobId: string, name: string) =>
    `/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(name)}`,

  archiveUrl: (jobId: string) =>
    `/api/jobs/${encodeURIComponent(jobId)}/archive`,

  /** The trace as uploaded. Gone once retention has purged it. */
  traceUrl: (jobId: string) => `/api/jobs/${encodeURIComponent(jobId)}/trace`,

  updateMachine: (id: string, form: FormData) =>
    request<{ machine: Machine }>(`/api/machines/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: form,
    }).then((r) => r.machine),

  readFile: async (jobId: string, name: string): Promise<string> => {
    const response = await fetch(api.fileUrl(jobId, name));
    if (!response.ok) throw new ApiError(response.status, 'not-found', '');
    return response.text();
  },
};

/**
 * Uploads a trace with progress.
 *
 * `XMLHttpRequest` rather than `fetch`: a 300 MB upload over shop-floor wifi
 * takes long enough that a progress bar is the difference between "working"
 * and "frozen", and upload progress is still the one thing `fetch` cannot
 * report.
 *
 * The upload carries no machine and no program name. What comes back is the
 * trace and its analysis; choosing what to do with it is the next step.
 */
export function uploadTrace(
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<{ trace: Trace; cached: boolean }>; abort: () => void } {
  const query = new URLSearchParams({ filename: file.name });

  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ trace: Trace; cached: boolean }>(
    (resolve, reject) => {
      xhr.open('POST', `/api/traces?${query.toString()}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });

      xhr.addEventListener('load', () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // Falls through to the status check below.
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as { trace: Trace; cached: boolean });
          return;
        }
        const error = (body as { error?: { code?: string; message?: string } })
          ?.error;
        reject(
          new ApiError(
            xhr.status,
            error?.code ?? 'unknown',
            error?.message ?? '',
          ),
        );
      });

      xhr.addEventListener('error', () =>
        reject(new ApiError(0, 'network', m.errorNetwork)),
      );
      xhr.addEventListener('abort', () =>
        reject(new ApiError(0, 'aborted', '')),
      );

      xhr.send(file);
    },
  );

  return { promise, abort: () => xhr.abort() };
}
