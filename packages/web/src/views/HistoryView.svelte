<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Check from 'lucide-svelte/icons/check';
  import CircleAlert from 'lucide-svelte/icons/circle-alert';
  import Clock from 'lucide-svelte/icons/clock';
  import Inbox from 'lucide-svelte/icons/inbox';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import { api, type Job } from '../api';
  import { faDigits, formatBytes, formatWhen } from '../format';
  import { m } from '../messages/fa';
  import { router, routeHref } from '../router.svelte';

  let jobs = $state<Job[]>([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      jobs = await api.listJobs(50);
    } catch {
      jobs = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function label(job: Job): string {
    if (job.status === 'queued') return m.statusQueued;
    if (job.status === 'running') return m.statusRunning;
    if (job.status === 'failed') return m.statusFailed;
    return job.blocked ? m.statusFailed : m.statusDone;
  }

  /** Plain clicks route in-app; modified clicks stay the browser's. */
  function open(event: MouseEvent, id: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    router.go({ name: 'job', id });
  }
</script>

<section class="card">
  <header>
    <h2>{m.navHistory}</h2>
    <button class="ghost" onclick={load} disabled={loading}>
      <span class:spinning={loading}><RefreshCw size={16} /></span>
      {m.refresh}
    </button>
  </header>

  {#if jobs.length === 0}
    <p class="empty">
      {#if loading}
        …
      {:else}
        <Inbox size={30} />
        <span>{m.historyEmpty}</span>
      {/if}
    </p>
  {:else}
    <ul>
      {#each jobs as job, index (job.id)}
        <li in:fly={{ y: 8, duration: 220, delay: Math.min(index, 10) * 25, easing: cubicOut }}>
          <!-- A real link: it can be copied, opened in a new tab, and shared. -->
          <a
            class="row"
            href={routeHref({ name: 'job', id: job.id })}
            onclick={(event) => open(event, job.id)}
          >
            <span class="badge {job.status}" class:blocked={job.blocked}>
              {#if job.status === 'done' && !job.blocked}<Check size={13} />{/if}
              {#if job.status === 'failed' || job.blocked}<CircleAlert size={13} />{/if}
              {#if job.status === 'queued' || job.status === 'running'}<Clock size={13} />{/if}
              {label(job)}
            </span>
            <span class="names">
              <strong class="ltr">{job.traceName}</strong>
              <small>
                {job.machineName ?? job.machineId} · {formatBytes(job.traceBytes)}
                {#if job.tracePurged} · {m.tracePurged}{/if}
              </small>
            </span>
            <span class="files">
              {job.files.length > 0
                ? `${faDigits(job.files.length)} ${m.historyFiles}`
                : '—'}
            </span>
            <time datetime={new Date(job.createdAt).toISOString()}>
              {formatWhen(job.createdAt)}
            </time>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .card {
    padding: 1.4rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.1rem;
  }

  .ghost {
    display: inline-flex;
    gap: 0.45rem;
    align-items: center;
    min-height: 42px;
    padding: 0 1rem;
    color: var(--muted);
    font-weight: 600;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .ghost:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }

  .spinning {
    display: inline-grid;
    place-items: center;
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .empty {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: center;
    padding: 3rem 1rem;
    color: var(--muted);
  }

  ul {
    margin: 0;
    padding: 0;
    overflow: hidden;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  li + li {
    border-top: 1px solid var(--border);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    align-items: center;
    width: 100%;
    min-height: 64px;
    padding: 0.7rem 1rem;
    color: inherit;
    text-align: right;
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease-out);
  }

  .row:hover {
    background: color-mix(in srgb, var(--accent) 6%, var(--panel));
  }

  .badge {
    display: inline-flex;
    gap: 0.28rem;
    align-items: center;
    justify-content: center;
    min-width: 5.4rem;
    padding: 0.2rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 700;
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

  .names {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 10rem;
    line-height: 1.4;
  }

  .names strong {
    overflow: hidden;
    font-size: 0.94rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .names small,
  .files,
  time {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .files {
    min-width: 5rem;
  }

  time {
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinning {
      animation-duration: 3s;
    }
  }
</style>
