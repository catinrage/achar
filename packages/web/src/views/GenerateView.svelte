<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { ApiError, api, submitJob, type Job, type Machine } from '../api';
  import DropZone from '../components/DropZone.svelte';
  import JobResult from '../components/JobResult.svelte';
  import Select, { type SelectOption } from '../components/Select.svelte';
  import { faDigits } from '../format';
  import { m } from '../messages/fa';
  import { router } from '../router.svelte';

  interface Props {
    machines: Machine[];
    /** Set when the route names a job, so a link opens straight onto it. */
    jobId?: string;
  }

  let { machines, jobId }: Props = $props();

  let file = $state<File | null>(null);
  let machineId = $state('');
  let programName = $state('');
  /** The last value this view filled in, so a typed one is never overwritten. */
  let inferredName = $state('');
  let uploading = $state(false);
  let uploadFraction = $state(0);
  let job = $state<Job | null>(null);
  let cached = $state(false);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let results = $state<HTMLDivElement | undefined>(undefined);
  let scrolledTo = $state<string | null>(null);

  /** Poll interval while a job is queued or running. */
  const POLL_MS = 1000;

  const canSubmit = $derived(
    file !== null && machineId !== '' && !uploading && !isPending(job),
  );

  const machineOptions = $derived<SelectOption[]>(
    machines.map((machine) => ({
      value: machine.id,
      label: machine.name,
      detail: [
        machine.postName,
        machine.hasVmid ? m.machineHasVmid : null,
        machine.hasProfile ? m.machineHasProfile : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
  );

  function isPending(candidate: Job | null): boolean {
    return candidate?.status === 'queued' || candidate?.status === 'running';
  }

  /**
   * The program name a trace file implies: its own name without the extension.
   *
   * SolidCAM names the trace after the part, so this is almost always what the
   * operator would have typed. It is only a default — the server still falls
   * back to the trace's `part_name` if the field is cleared.
   */
  function inferProgramName(name: string): string {
    return name.replace(/\.[^.]+$/, '').trim();
  }

  /**
   * Prefills the program name from a newly chosen file.
   *
   * Only overwrites a value this view put there itself, so picking a different
   * file updates the suggestion while anything the operator typed survives.
   */
  function chooseFile(picked: File | null) {
    file = picked;
    error = null;

    if (!picked) {
      if (programName === inferredName) programName = '';
      inferredName = '';
      return;
    }

    const suggestion = inferProgramName(picked.name);
    if (programName === '' || programName === inferredName) {
      programName = suggestion;
    }
    inferredName = suggestion;
  }

  // A single machine is the common case; preselecting it removes a required
  // choice that has only one answer.
  $effect(() => {
    if (machineId === '' && machines.length === 1) {
      machineId = machines[0]!.id;
    }
  });

  // The route owns which job is shown, so a shared link, a history click and a
  // reload all arrive here the same way.
  $effect(() => {
    const requested = jobId;
    if (!requested) {
      if (!uploading) job = null;
      return;
    }
    if (job?.id === requested) return;

    loading = true;
    api
      .getJob(requested)
      .then((loaded) => {
        job = loaded;
        cached = false;
        error = null;
      })
      .catch(() => (error = m.errorJobMissing))
      .finally(() => (loading = false));
  });

  /**
   * Brings a newly shown job into view.
   *
   * The upload form stays on the page above it, so a job opened from a link —
   * or a second one generated after the first — would otherwise appear below
   * the fold with nothing on screen to say anything had happened. Keyed on the
   * id, not the object, so the once-a-second poll does not fight the scroll.
   */
  $effect(() => {
    const id = job?.id;
    if (!id || id === scrolledTo || !results) return;
    scrolledTo = id;
    results.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'start',
    });
  });

  /**
   * Polls until the job settles.
   *
   * The effect re-runs whenever `job` changes, so each poll schedules exactly
   * one successor and the timer is cleared when the job settles or the view is
   * torn down.
   */
  $effect(() => {
    const current = job;
    if (!isPending(current)) return;

    const timer = setTimeout(async () => {
      try {
        job = await api.getJob(current!.id);
      } catch {
        // A single failed poll is not worth surfacing; the next tick retries.
      }
    }, POLL_MS);

    return () => clearTimeout(timer);
  });

  async function start() {
    if (!file || !machineId) return;
    error = null;
    cached = false;
    uploading = true;
    uploadFraction = 0;

    const { promise } = submitJob(
      file,
      { machineId, programName: programName.trim() || undefined },
      (fraction) => (uploadFraction = fraction),
    );

    try {
      const result = await promise;
      job = result.job;
      cached = result.cached;
      // Give the job its own address the moment it exists, so the link is
      // shareable while it is still queued.
      router.go({ name: 'job', id: result.job.id });
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : m.errorGeneric;
    } finally {
      uploading = false;
    }
  }
</script>

<div class="layout">
  <section class="card">
    {#if machines.length === 0}
      <p class="notice">{m.noMachines}</p>
    {/if}

    <DropZone
      {file}
      disabled={uploading || machines.length === 0}
      onselect={chooseFile}
    />

    <div class="fields">
      <div class="field">
        <span class="field-label" id="machine-label">{m.machineLabel}</span>
        <Select
          value={machineId}
          options={machineOptions}
          placeholder={m.machinePlaceholder}
          disabled={uploading || machines.length === 0}
          label={m.machineLabel}
          onchange={(next) => (machineId = next)}
        />
      </div>

      <label class="field">
        <span class="field-label">{m.programNameLabel}</span>
        <input
          class="ltr"
          type="text"
          bind:value={programName}
          disabled={uploading}
          placeholder="—"
        />
        <small>
          {programName === inferredName && inferredName !== ''
            ? m.programNameInferred
            : m.programNameHint}
        </small>
      </label>
    </div>

    {#if uploading}
      <div class="upload" role="status" transition:fly={{ y: -8, duration: 180, easing: cubicOut }}>
        <div class="track">
          <div class="fill" style:width={`${Math.round(uploadFraction * 100)}%`}></div>
        </div>
        <span>
          {m.uploadProgress} — {faDigits(Math.round(uploadFraction * 100))}٪
        </span>
      </div>
    {/if}

    {#if error}
      <p class="error" role="alert" transition:fly={{ y: -8, duration: 180 }}>
        {error}
      </p>
    {/if}

    <button class="submit" disabled={!canSubmit} onclick={start}>
      {uploading ? m.submitting : m.submit}
    </button>
  </section>

  {#if loading && !job}
    <p class="loading">…</p>
  {/if}

  {#if job}
    <div bind:this={results}>
      <JobResult {job} {cached} />
    </div>
  {/if}
</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    padding: 1.4rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
  }

  .notice {
    margin: 0;
    padding: 0.85rem 1rem;
    color: var(--warning);
    background: var(--warning-soft);
    border-radius: var(--radius-sm);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field-label {
    font-size: 0.88rem;
    font-weight: 600;
  }

  .field small {
    color: var(--faint);
    font-size: 0.78rem;
  }

  input[type='text'] {
    min-height: 52px;
    padding: 0 0.9rem;
    background: var(--panel-subtle);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  input[type='text']:hover:not(:disabled),
  input[type='text']:focus {
    border-color: var(--accent);
  }

  input:disabled {
    opacity: 0.55;
  }

  .submit {
    min-height: 60px;
    color: #fff;
    font-size: 1.06rem;
    font-weight: 700;
    background: var(--accent);
    border-radius: var(--radius-sm);
    transition:
      background var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .submit:hover:not(:disabled) {
    background: var(--accent-strong);
  }

  .submit:active:not(:disabled) {
    transform: scale(0.99);
  }

  .submit:disabled {
    color: var(--faint);
    background: var(--panel-strong);
    cursor: default;
  }

  .upload {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .upload span {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .track {
    height: 8px;
    overflow: hidden;
    background: var(--panel-strong);
    border-radius: 999px;
  }

  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-soft), var(--accent));
    border-radius: 999px;
    transition: width 120ms linear;
  }

  .error {
    margin: 0;
    padding: 0.8rem 1rem;
    color: var(--danger);
    background: var(--danger-soft);
    border-radius: var(--radius-sm);
  }

  .loading {
    padding: 2rem;
    color: var(--muted);
    text-align: center;
  }
</style>
