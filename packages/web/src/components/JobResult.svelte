<script lang="ts">
  import { fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Boxes from 'lucide-svelte/icons/boxes';
  import Check from 'lucide-svelte/icons/check';
  import CircleAlert from 'lucide-svelte/icons/circle-alert';
  import Clock from 'lucide-svelte/icons/clock';
  import FileDown from 'lucide-svelte/icons/file-down';
  import Files from 'lucide-svelte/icons/files';
  import Link from 'lucide-svelte/icons/link';
  import Wrench from 'lucide-svelte/icons/wrench';
  import { api, type Job } from '../api';
  import Diagnostics from './Diagnostics.svelte';
  import FilesPanel from './FilesPanel.svelte';
  import FileViewer from './FileViewer.svelte';
  import Spinner from './Spinner.svelte';
  import TimingPanel from './TimingPanel.svelte';
  import ToolsPanel from './ToolsPanel.svelte';
  import { faDigits, formatBytes, formatMilliseconds } from '../format';
  import { fill, m } from '../messages/fa';
  import { routeHref } from '../router.svelte';

  interface Props {
    job: Job;
    cached?: boolean;
  }

  let { job, cached = false }: Props = $props();

  type Tab = 'files' | 'timing' | 'tools';
  let tab = $state<Tab>('files');
  let viewing = $state<string | null>(null);
  let copied = $state(false);

  const pending = $derived(job.status === 'queued' || job.status === 'running');
  const toolCount = $derived(job.profile?.tools?.length ?? 0);
  /**
   * A partial program carries the same filenames a full one does, so saying so
   * is not a nicety: two of these in one folder overwrite each other silently.
   */
  const partial = $derived(job.setups !== null && job.setups.length > 0);

  const tabs = $derived<
    Array<{ id: Tab; label: string; count?: number; icon: typeof Files }>
  >([
    { id: 'files', label: m.tabFiles, count: job.files.length, icon: Files },
    { id: 'timing', label: m.tabTiming, icon: Clock },
    { id: 'tools', label: m.tabTools, count: toolCount, icon: Wrench },
  ]);

  const statusLabel = $derived(
    job.status === 'queued'
      ? m.statusQueued
      : job.status === 'running'
        ? m.statusRunning
        : job.status === 'failed'
          ? m.statusFailed
          : job.blocked
            ? m.statusFailed
            : m.statusDone,
  );

  async function copyLink() {
    const url = new URL(
      routeHref({ name: 'job', id: job.id }),
      window.location.origin,
    ).toString();
    await navigator.clipboard.writeText(url);
    copied = true;
    setTimeout(() => (copied = false), 1800);
  }
</script>

<article class="result" class:pending>
  <header>
    <div class="title">
      <span class="badge {job.status}" class:blocked={job.blocked}>
        {#if job.status === 'done' && !job.blocked}<Check size={14} />{/if}
        {#if job.status === 'failed' || job.blocked}<CircleAlert size={14} />{/if}
        {statusLabel}
      </span>
      <div class="names">
        <strong class="ltr">{job.traceName}</strong>
        <small>
          {job.machineName ?? job.machineId}
          · {formatBytes(job.traceBytes)}
          {#if job.durationMs !== null}
            · {formatMilliseconds(job.durationMs)}
          {/if}
        </small>
      </div>
    </div>

    <div class="header-actions">
      <button class="chip" onclick={copyLink} title={m.copyLink}>
        {#if copied}
          <span in:scale={{ duration: 160, start: 0.6 }}><Check size={15} /></span>
          <span class="wide">{m.linkCopied}</span>
        {:else}
          <Link size={15} />
          <span class="wide">{m.copyLink}</span>
        {/if}
      </button>

      <!-- The trace outlives nothing else here: retention deletes it while the
           job row and its output stay, so the link disappears with it. -->
      {#if !job.tracePurged}
        <a
          class="chip"
          href={api.traceUrl(job.id)}
          download={job.traceName}
          title={m.downloadTrace}
        >
          <FileDown size={15} />
          <span class="wide">{m.downloadTrace}</span>
        </a>
      {:else}
        <span class="chip muted" title={m.tracePurged}>
          <FileDown size={15} />
          <span class="wide">{m.tracePurged}</span>
        </span>
      {/if}
    </div>
  </header>

  {#if cached}
    <p class="note">{m.cachedNotice}</p>
  {/if}

  {#if partial}
    <p class="partial">
      <Boxes size={15} />
      <span>
        <strong>{m.setupsPartial}</strong>
        {fill(m.setupsPartialBody, {
          setups: (job.selectedSetups ?? [])
            .map((setup) => `${faDigits(setup.index)} (${setup.name})`)
            .join('، ') || (job.setups ?? []).map(faDigits).join('، '),
        })}
      </span>
    </p>
  {/if}

  {#if job.status === 'queued' || job.status === 'running'}
    <div class="progress" transition:fly={{ y: -6, duration: 200 }}>
      <Spinner running={job.status === 'running'} />
      <div>
        <strong>
          {#if job.status === 'running'}
            {m.statusRunning}
          {:else if job.position && job.position > 1}
            {fill(m.queuePosition, { n: faDigits(job.position) })}
          {:else}
            {m.queueFirst}
          {/if}
        </strong>
        <small>{m.runningHint}</small>
      </div>
    </div>
  {:else if job.status === 'failed'}
    <div class="failure">
      <strong><CircleAlert size={17} /> {m.jobFailed}</strong>
      {#if job.error}<span class="ltr detail">{job.error}</span>{/if}
    </div>
  {:else}
    <Diagnostics diagnostics={job.diagnostics} blocked={job.blocked} />

    <nav class="tabs" aria-label={m.tabFiles}>
      {#each tabs as entry (entry.id)}
        <button
          class:active={tab === entry.id}
          onclick={() => (tab = entry.id)}
        >
          <entry.icon size={16} />
          {entry.label}
          {#if entry.count !== undefined && entry.count > 0}
            <span class="pill">{faDigits(entry.count)}</span>
          {/if}
        </button>
      {/each}
    </nav>

    {#key tab}
      <div class="tab-body" in:fly={{ y: 8, duration: 180, easing: cubicOut }}>
        {#if tab === 'files'}
          <FilesPanel
            jobId={job.id}
            files={job.files}
            onview={(name) => (viewing = name)}
          />
        {:else if tab === 'timing'}
          <TimingPanel timing={job.timing} />
        {:else}
          <ToolsPanel profile={job.profile} />
        {/if}
      </div>
    {/key}
  {/if}
</article>

{#if viewing}
  <FileViewer jobId={job.id} name={viewing} onclose={() => (viewing = null)} />
{/if}

<style>
  .result {
    padding: 1.25rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .title {
    display: flex;
    gap: 0.9rem;
    align-items: center;
    min-width: 0;
  }

  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.4;
  }

  .names strong {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .names small {
    color: var(--muted);
    font-size: 0.84rem;
  }

  .badge {
    display: inline-flex;
    gap: 0.3rem;
    align-items: center;
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
    border-radius: 999px;
  }

  .badge.done {
    color: var(--accent-strong);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .badge.done.blocked,
  .badge.failed {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .badge.queued,
  .badge.running {
    color: var(--warning);
    background: var(--warning-soft);
  }

  .header-actions {
    display: flex;
    gap: 0.4rem;
  }

  .chip {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    min-height: 38px;
    padding: 0 0.8rem;
    color: var(--muted);
    font-size: 0.84rem;
    font-weight: 600;
    text-decoration: none;
    background: var(--panel-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .chip:not(.muted):hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .chip.muted {
    opacity: 0.5;
    cursor: default;
  }

  .partial {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    margin: 0 0 1rem;
    padding: 0.8rem 1rem;
    color: var(--muted);
    font-size: 0.86rem;
    background: var(--warning-soft);
    border-radius: var(--radius-sm);
  }

  .partial :global(svg) {
    flex: none;
    margin-top: 0.15rem;
    color: var(--warning);
  }

  .partial strong {
    margin-inline-end: 0.3rem;
    color: var(--warning);
  }

  .note {
    margin: 0 0 1rem;
    padding: 0.7rem 0.95rem;
    color: var(--muted);
    font-size: 0.88rem;
    background: var(--panel-subtle);
    border-radius: var(--radius-sm);
  }

  .progress {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 1.4rem 1.1rem;
    background: var(--panel-subtle);
    border-radius: var(--radius);
  }

  .progress strong {
    display: block;
  }

  .progress small {
    color: var(--muted);
    font-size: 0.86rem;
  }

  .failure {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 1.1rem;
    color: var(--danger);
    background: var(--danger-soft);
    border-radius: var(--radius);
  }

  .failure strong {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
  }

  .failure .detail {
    color: var(--muted);
    font-size: 0.87rem;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    margin: 1rem 0 1.1rem;
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    display: inline-flex;
    gap: 0.45rem;
    align-items: center;
    min-height: 46px;
    padding: 0 1rem;
    color: var(--muted);
    font-weight: 600;
    border-bottom: 2px solid transparent;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .tabs button.active :global(svg) {
    color: var(--accent);
  }

  .pill {
    padding: 0.05rem 0.45rem;
    color: var(--muted);
    font-size: 0.75rem;
    background: var(--panel-strong);
    border-radius: 999px;
  }

  @media (max-width: 620px) {
    .wide {
      display: none;
    }
  }
</style>
