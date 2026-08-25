<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Boxes from 'lucide-svelte/icons/boxes';
  import Clock from 'lucide-svelte/icons/clock';
  import CircleAlert from 'lucide-svelte/icons/circle-alert';
  import FileText from 'lucide-svelte/icons/file-text';
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
  import Wrench from 'lucide-svelte/icons/wrench';
  import {
    ApiError,
    api,
    uploadTrace,
    type Job,
    type Machine,
    type Trace,
  } from '../api';
  import Diagnostics from '../components/Diagnostics.svelte';
  import DropZone from '../components/DropZone.svelte';
  import JobResult from '../components/JobResult.svelte';
  import Select, { type SelectOption } from '../components/Select.svelte';
  import SetupPicker from '../components/SetupPicker.svelte';
  import Spinner from '../components/Spinner.svelte';
  import { faDigits, formatBytes, formatCycleTime } from '../format';
  import { fill, m } from '../messages/fa';
  import { router } from '../router.svelte';

  /**
   * Upload, then choose, then generate.
   *
   * The two halves are separate because the operator cannot answer the only
   * question that matters — which setups to post — until something has read
   * the file. So the upload buys an analysis: the setup list, the cycle time
   * and the tool list, none of which depend on a machine. The choice comes
   * after, and costs no second upload.
   */

  interface Props {
    machines: Machine[];
    /** Set when the route names a job, so a link opens straight onto it. */
    jobId?: string;
    /** Set when the route names a trace, so its analysis reopens as it was. */
    traceSha?: string;
  }

  let { machines, jobId, traceSha }: Props = $props();

  let file = $state<File | null>(null);
  let uploading = $state(false);
  let uploadFraction = $state(0);
  let trace = $state<Trace | null>(null);
  let traceCached = $state(false);

  let machineId = $state('');
  let programName = $state('');
  /** The last value this view filled in, so a typed one is never overwritten. */
  let inferredName = $state('');
  let selectedSetups = $state<number[]>([]);
  let keepAllTools = $state(false);

  let job = $state<Job | null>(null);
  let cached = $state(false);
  let generating = $state(false);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let results = $state<HTMLDivElement | undefined>(undefined);
  let scrolledTo = $state<string | null>(null);

  /** Poll interval while an analysis or a job is in flight. */
  const POLL_MS = 1000;

  const ready = $derived(trace?.status === 'ready');
  const hasSetups = $derived((trace?.setups.length ?? 0) > 0);
  const canSubmit = $derived(
    ready &&
      machineId !== '' &&
      !generating &&
      !isPending(job) &&
      (!hasSetups || selectedSetups.length > 0),
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
   * The program name a trace implies: its file name without the extension.
   *
   * SolidCAM names the trace after the part, so this is almost always what the
   * operator would have typed. It is only a default — the server still falls
   * back to the trace's `part_name` if the field is cleared.
   */
  function inferProgramName(name: string): string {
    return name.replace(/\.[^.]+$/, '').trim();
  }

  /**
   * Adopts a freshly analysed trace.
   *
   * Every setup starts ticked: posting the whole part is what this tool did
   * before the choice existed, and it is still what most jobs want. Ticking
   * them all is also identical to ticking none — the server stores a full
   * selection as "the whole part" — so the default path is unchanged.
   */
  function adopt(loaded: Trace) {
    trace = loaded;
    selectedSetups = loaded.setups.map((setup) => setup.index);
    keepAllTools = false;

    const suggestion = inferProgramName(loaded.name);
    if (programName === '' || programName === inferredName) {
      programName = suggestion;
    }
    inferredName = suggestion;
  }

  function restart() {
    file = null;
    trace = null;
    traceCached = false;
    job = null;
    error = null;
    selectedSetups = [];
    keepAllTools = false;
    if (programName === inferredName) programName = '';
    inferredName = '';
    router.go({ name: 'generate' });
  }

  async function chooseFile(picked: File | null) {
    if (!picked) {
      restart();
      return;
    }

    file = picked;
    error = null;
    job = null;
    trace = null;
    uploading = true;
    uploadFraction = 0;

    const { promise } = uploadTrace(picked, (fraction) => {
      uploadFraction = fraction;
    });

    try {
      const result = await promise;
      traceCached = result.cached;
      adopt(result.trace);
      // The trace gets its own address the moment it exists, so the analysis
      // survives a reload and can be sent to someone else.
      router.go({ name: 'trace', sha: result.trace.sha256 });
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : m.errorGeneric;
      file = null;
    } finally {
      uploading = false;
    }
  }

  // A single machine is the common case; preselecting it removes a required
  // choice that has only one answer.
  $effect(() => {
    if (machineId === '' && machines.length === 1) {
      machineId = machines[0]!.id;
    }
  });

  // The route owns what is shown, so a shared link, a history click and a
  // reload all arrive here the same way.
  $effect(() => {
    const requested = jobId;
    if (!requested) {
      if (!uploading && !generating) job = null;
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
        // Opening a job cold should still show what it was posted from, so
        // the setup picker beside it is loaded and set to that job's choice.
        void adoptJobTrace(loaded);
      })
      .catch(() => (error = m.errorJobMissing))
      .finally(() => (loading = false));
  });

  $effect(() => {
    const requested = traceSha;
    if (!requested || trace?.sha256 === requested || uploading) return;

    loading = true;
    api
      .getTrace(requested)
      .then((loaded) => {
        traceCached = false;
        adopt(loaded);
      })
      .catch(() => (error = m.errorTraceMissing))
      .finally(() => (loading = false));
  });

  /** Loads the trace behind a job opened from a link, if it is still known. */
  async function adoptJobTrace(opened: Job) {
    if (trace?.sha256 === opened.traceSha256) return;
    try {
      const loaded = await api.getTrace(opened.traceSha256);
      adopt(loaded);
      if (opened.setups) selectedSetups = opened.setups;
      keepAllTools = opened.keepAllTools;
      machineId = opened.machineId;
      // The job's own name, not the one the file name implies: reopening a
      // link should show what was generated, and generating again from here
      // should not quietly rename the output.
      if (opened.programName) programName = opened.programName;
    } catch {
      // A purged or unknown trace is not an error here: the job's own results
      // are what the link was for, and they are already on screen.
    }
  }

  /**
   * Brings a newly shown job into view.
   *
   * The picker stays on the page above it, so a job opened from a link — or a
   * second one generated after the first — would otherwise appear below the
   * fold with nothing on screen to say anything had happened. Keyed on the id,
   * not the object, so the once-a-second poll does not fight the scroll.
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

  /** Polls until the analysis settles. */
  $effect(() => {
    const current = trace;
    if (current?.status !== 'analyzing') return;

    const timer = setTimeout(async () => {
      try {
        const loaded = await api.getTrace(current.sha256);
        if (loaded.status === 'analyzing') trace = loaded;
        else adopt(loaded);
      } catch {
        // A single failed poll is not worth surfacing; the next tick retries.
      }
    }, POLL_MS);

    return () => clearTimeout(timer);
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
        // As above: one missed poll, one retry.
      }
    }, POLL_MS);

    return () => clearTimeout(timer);
  });

  async function start() {
    if (!trace || !machineId) return;
    error = null;
    cached = false;
    generating = true;

    try {
      const result = await api.createJob({
        traceSha: trace.sha256,
        machineId,
        programName: programName.trim() || undefined,
        // A full selection is left unsaid: it means the whole part, which is
        // what the server stores and what keeps the default path unchanged.
        setups:
          hasSetups && selectedSetups.length < trace.setups.length
            ? selectedSetups
            : undefined,
        keepAllTools,
      });
      job = result.job;
      cached = result.cached;
      router.go({ name: 'job', id: result.job.id });
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : m.errorGeneric;
    } finally {
      generating = false;
    }
  }
</script>

<div class="layout">
  <section class="card">
    {#if machines.length === 0}
      <p class="notice">{m.noMachines}</p>
    {/if}

    {#if !trace}
      <DropZone
        {file}
        disabled={uploading || machines.length === 0}
        onselect={chooseFile}
      />
    {:else}
      <div class="trace-head">
        <span class="trace-name">
          <FileText size={17} />
          <strong class="ltr">{trace.name}</strong>
          <small>{formatBytes(trace.bytes)}</small>
        </span>
        <button class="chip" onclick={restart} disabled={generating}>
          <RotateCcw size={15} />
          {m.changeFile}
        </button>
      </div>
    {/if}

    {#if uploading}
      <div
        class="upload"
        role="status"
        transition:fly={{ y: -8, duration: 180, easing: cubicOut }}
      >
        <div class="track">
          <div
            class="fill"
            style:width={`${Math.round(uploadFraction * 100)}%`}
          ></div>
        </div>
        <span>
          {m.uploadProgress} — {faDigits(Math.round(uploadFraction * 100))}٪
        </span>
      </div>
    {/if}

    {#if trace?.status === 'analyzing'}
      <div class="analyzing" role="status" transition:fly={{ y: -6, duration: 180 }}>
        <Spinner running={true} />
        <div>
          <strong>{m.analyzing}</strong>
          <small>{m.analyzingHint}</small>
        </div>
      </div>
    {/if}

    {#if trace?.status === 'failed'}
      <div class="failure">
        <strong><CircleAlert size={17} /> {m.analysisFailed}</strong>
        {#if trace.error}<span class="ltr detail">{trace.error}</span>{/if}
      </div>
    {/if}

    {#if ready && trace}
      {#if traceCached}
        <p class="note">{m.traceCached}</p>
      {/if}

      <div class="summary">
        {#if trace.profile?.part.name}
          <span><FileText size={15} /> {m.tracePart}: <strong class="ltr">{trace.profile.part.name}</strong></span>
        {/if}
        {#if trace.timing}
          <span><Clock size={15} /> {m.traceTotal}: <strong>{formatCycleTime(trace.timing.duration)}</strong></span>
        {/if}
        {#if hasSetups}
          <span><Boxes size={15} /> {fill(m.traceSetupsCount, { n: faDigits(trace.setups.length) })}</span>
        {/if}
        {#if trace.profile}
          <span><Wrench size={15} /> {fill(m.traceToolsCount, { n: faDigits(trace.profile.tools.length) })}</span>
        {/if}
      </div>

      <Diagnostics diagnostics={trace.diagnostics} blocked={false} />

      {#if hasSetups}
        <SetupPicker
          setups={trace.setups}
          selected={selectedSetups}
          hasImplicitSetup={trace.hasImplicitSetup}
          {keepAllTools}
          disabled={generating}
          onchange={(next) => (selectedSetups = next)}
          onkeepalltools={(keep) => (keepAllTools = keep)}
        />
      {:else}
        <p class="note">{m.setupsNoneInTrace}</p>
      {/if}

      <div class="fields">
        <div class="field">
          <span class="field-label" id="machine-label">{m.machineLabel}</span>
          <Select
            value={machineId}
            options={machineOptions}
            placeholder={m.machinePlaceholder}
            disabled={generating || machines.length === 0}
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
            disabled={generating}
            placeholder="—"
          />
          <small>
            {programName === inferredName && inferredName !== ''
              ? m.programNameInferred
              : m.programNameHint}
          </small>
        </label>
      </div>

      {#if hasSetups && selectedSetups.length === 0}
        <p class="notice">{m.setupsSelectAtLeastOne}</p>
      {/if}
    {/if}

    {#if error}
      <p class="error" role="alert" transition:fly={{ y: -8, duration: 180 }}>
        {error}
      </p>
    {/if}

    {#if ready}
      <button class="submit" disabled={!canSubmit} onclick={start}>
        {generating ? m.submitting : m.submit}
      </button>
    {/if}
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

  .note {
    margin: 0;
    padding: 0.8rem 1rem;
    color: var(--muted);
    font-size: 0.87rem;
    background: var(--panel-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .trace-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
  }

  .trace-name {
    display: inline-flex;
    gap: 0.5rem;
    align-items: center;
    min-width: 0;
  }

  .trace-name :global(svg) {
    flex: none;
    color: var(--accent);
  }

  .trace-name strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trace-name small {
    color: var(--faint);
    font-size: 0.8rem;
  }

  .chip {
    display: inline-flex;
    flex: none;
    gap: 0.4rem;
    align-items: center;
    padding: 0.5rem 0.85rem;
    color: var(--muted);
    font-size: 0.84rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .chip:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.25rem;
    padding: 0.85rem 1rem;
    font-size: 0.87rem;
    background: var(--panel-subtle);
    border-radius: var(--radius-sm);
  }

  .summary span {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    color: var(--muted);
  }

  .summary :global(svg) {
    color: var(--accent);
  }

  .summary strong {
    color: var(--text);
  }

  .analyzing,
  .failure {
    display: flex;
    gap: 0.85rem;
    align-items: center;
    padding: 0.9rem 1rem;
    border-radius: var(--radius-sm);
  }

  .analyzing {
    background: var(--panel-subtle);
  }

  .analyzing strong,
  .failure strong {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .analyzing small {
    display: block;
    color: var(--faint);
    font-size: 0.82rem;
  }

  .failure {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    color: var(--danger);
    background: var(--danger-soft);
  }

  .failure .detail {
    color: var(--muted);
    font-size: 0.83rem;
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
