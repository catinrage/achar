<script lang="ts">
  import { fly, slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Check from 'lucide-svelte/icons/check';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import CircleAlert from 'lucide-svelte/icons/circle-alert';
  import Clock from 'lucide-svelte/icons/clock';
  import Inbox from 'lucide-svelte/icons/inbox';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { api, ApiError, type Job } from '../api';
  import { faDigits, formatBytes, formatWhen } from '../format';
  import { m } from '../messages/fa';
  import { router, routeHref } from '../router.svelte';

  /**
   * One project's generations.
   *
   * The same part is posted many times over its life — a setup at a time, once
   * per machine, again after the CAM file changes — and flat history buries
   * yesterday's work under today's. Grouping is by trace name because SolidCAM
   * names the trace after the part, so it is the one field that stays the same
   * across every one of those runs.
   */
  interface JobGroup {
    key: string;
    name: string;
    jobs: Job[];
    latestAt: number;
    problems: number;
    deletableIds: string[];
  }

  /** How many deletes run at once during a batch. */
  const DELETE_CONCURRENCY = 4;

  let jobs = $state<Job[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  /** Ids with a delete in flight, so a row cannot be submitted twice. */
  let deleting = $state<string[]>([]);
  /** Group keys the operator has open. */
  let expanded = $state<string[]>([]);
  /** Ids ticked for a batch delete. */
  let selected = $state<string[]>([]);
  /** Set once the first response has been grouped, so auto-opening happens once. */
  let opened = false;

  const groups = $derived(groupJobs(jobs));
  const allExpanded = $derived(
    groups.length > 0 && groups.every((group) => expanded.includes(group.key)),
  );
  const selectedCount = $derived(selected.length);

  async function load() {
    loading = true;
    try {
      const list = await api.listJobs(50);
      jobs = list;

      const keys = groupJobs(list).map((group) => group.key);
      if (opened) {
        // A project whose last entry was deleted elsewhere must not keep a
        // stale key open, or reusing that name later opens it unasked.
        expanded = expanded.filter((key) => keys.includes(key));
      } else {
        opened = true;
        // The newest project only: history that opens as a wall of closed
        // rows makes the operator click before seeing what they just made.
        expanded = keys.slice(0, 1);
      }
      selected = selected.filter((id) => list.some((job) => job.id === id));
    } catch {
      jobs = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function groupKey(job: Job): string {
    const base = job.traceName.replace(/\.[^.]+$/, '').trim();
    return (base || job.traceName).toLocaleLowerCase();
  }

  function groupJobs(list: Job[]): JobGroup[] {
    const buckets = new Map<string, Job[]>();
    for (const job of list) {
      const key = groupKey(job);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(job);
      else buckets.set(key, [job]);
    }

    const built = [...buckets].map(([key, entries]) => {
      const ordered = [...entries].sort((a, b) => b.createdAt - a.createdAt);
      const newest = ordered[0];
      return {
        key,
        // The newest spelling of the name, since that is the file the
        // operator most recently held.
        name: newest.traceName,
        jobs: ordered,
        latestAt: newest.createdAt,
        problems: ordered.filter((job) => job.status === 'failed' || job.blocked)
          .length,
        deletableIds: ordered.filter((job) => !busy(job)).map((job) => job.id),
      };
    });

    return built.sort((a, b) => b.latestAt - a.latestAt);
  }

  function label(job: Job): string {
    if (job.status === 'queued') return m.statusQueued;
    if (job.status === 'running') return m.statusRunning;
    if (job.status === 'failed') return m.statusFailed;
    return job.blocked ? m.statusFailed : m.statusDone;
  }

  /** Still the queue's, so the server will refuse to delete it. */
  function busy(job: Job): boolean {
    return job.status === 'queued' || job.status === 'running';
  }

  function toggleGroup(key: string) {
    expanded = expanded.includes(key)
      ? expanded.filter((entry) => entry !== key)
      : [...expanded, key];
  }

  function toggleAllGroups() {
    expanded = allExpanded ? [] : groups.map((group) => group.key);
  }

  function toggleSelected(id: string) {
    selected = selected.includes(id)
      ? selected.filter((entry) => entry !== id)
      : [...selected, id];
  }

  /** A group is ticked as a whole, or not at all — unfinished jobs never tick. */
  function toggleGroupSelection(group: JobGroup) {
    const whole = groupSelection(group) === 'all';
    selected = whole
      ? selected.filter((id) => !group.deletableIds.includes(id))
      : [...new Set([...selected, ...group.deletableIds])];
  }

  function groupSelection(group: JobGroup): 'none' | 'some' | 'all' {
    const ticked = group.deletableIds.filter((id) => selected.includes(id));
    if (ticked.length === 0) return 'none';
    return ticked.length === group.deletableIds.length ? 'all' : 'some';
  }

  /**
   * Removes entries one after another, output and all.
   *
   * The list is updated per success rather than optimistically: a delete the
   * server refused — an unfinished job — must leave its row where it is,
   * because it is still going to produce something. Failures are counted and
   * reported together, so one bad id does not abandon the rest of a batch.
   */
  async function removeAll(ids: string[]): Promise<void> {
    const pending = ids.filter((id) => !deleting.includes(id));
    if (pending.length === 0) return;

    deleting = [...deleting, ...pending];
    error = null;

    const queue = [...pending];
    const failures: string[] = [];
    const drain = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          await api.deleteJob(id);
          jobs = jobs.filter((job) => job.id !== id);
          selected = selected.filter((entry) => entry !== id);
        } catch (caught) {
          failures.push(id);
          if (failures.length === 1) {
            error =
              caught instanceof ApiError ? caught.message : m.errorGeneric;
          }
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(DELETE_CONCURRENCY, queue.length) }, drain),
      );
      if (failures.length > 1) {
        error = `${faDigits(failures.length)} ${m.historyDeleteSomeFailed}`;
      }
    } finally {
      deleting = deleting.filter((id) => !pending.includes(id));
    }
  }

  function remove(job: Job) {
    if (!confirm(m.historyDeleteConfirm)) return;
    void removeAll([job.id]);
  }

  function removeSelected() {
    if (selected.length === 0) return;
    if (!confirm(m.historyDeleteSelectedConfirm)) return;
    void removeAll([...selected]);
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
    <div class="actions">
      {#if groups.length > 1}
        <button class="ghost" onclick={toggleAllGroups}>
          {allExpanded ? m.historyCollapseAll : m.historyExpandAll}
        </button>
      {/if}
      <button class="ghost" onclick={load} disabled={loading}>
        <span class:spinning={loading}><RefreshCw size={16} /></span>
        {m.refresh}
      </button>
    </div>
  </header>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if selectedCount > 0}
    <!-- Only while something is ticked: a permanently visible delete bar is a
         permanently visible way to lose a day's output. -->
    <div class="bulk" transition:slide={{ duration: 180, easing: cubicOut }}>
      <span class="count">{faDigits(selectedCount)} {m.historySelected}</span>
      <button class="ghost" onclick={() => (selected = [])}>
        {m.historyClearSelection}
      </button>
      <button
        class="danger"
        onclick={removeSelected}
        disabled={deleting.length > 0}
      >
        <Trash2 size={15} />
        {m.historyDeleteSelected}
      </button>
    </div>
  {/if}

  {#if groups.length === 0}
    <p class="empty">
      {#if loading}
        …
      {:else}
        <Inbox size={30} />
        <span>{m.historyEmpty}</span>
      {/if}
    </p>
  {:else}
    <div class="groups">
      {#each groups as group, groupIndex (group.key)}
        {@const isOpen = expanded.includes(group.key)}
        {@const selection = groupSelection(group)}
        <section
          class="group"
          in:fly={{
            y: 8,
            duration: 220,
            delay: Math.min(groupIndex, 8) * 30,
            easing: cubicOut,
          }}
        >
          <div class="group-head" class:open={isOpen}>
            <input
              class="tick"
              type="checkbox"
              title={m.historySelectGroup}
              aria-label={m.historySelectGroup}
              disabled={group.deletableIds.length === 0}
              checked={selection === 'all'}
              indeterminate={selection === 'some'}
              onchange={() => toggleGroupSelection(group)}
            />
            <button
              class="disclose"
              type="button"
              aria-expanded={isOpen}
              aria-controls={`group-${group.key}`}
              onclick={() => toggleGroup(group.key)}
            >
              <span class="chevron" class:open={isOpen}>
                <ChevronDown size={17} />
              </span>
              <span class="title">
                <strong class="ltr">{group.name}</strong>
                <small>
                  {faDigits(group.jobs.length)}
                  {m.historyGenerations} · {m.historyLatest}:
                  {formatWhen(group.latestAt)}
                </small>
              </span>
              {#if group.problems > 0}
                <span class="problems" title={m.statusFailed}>
                  <CircleAlert size={13} />
                  {faDigits(group.problems)}
                </span>
              {/if}
            </button>
          </div>

          {#if isOpen}
            <ul id={`group-${group.key}`} transition:slide={{ duration: 200, easing: cubicOut }}>
              {#each group.jobs as job (job.id)}
                <li>
                  <input
                    class="tick"
                    type="checkbox"
                    title={busy(job) ? m.historyDeleteBusy : m.historySelect}
                    aria-label={m.historySelect}
                    disabled={busy(job)}
                    checked={selected.includes(job.id)}
                    onchange={() => toggleSelected(job.id)}
                  />
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
                      <strong>
                        {job.machineName ?? job.machineId}
                        <!-- A partial program writes the same filenames a full one
                             does, so history has to say which is which. -->
                        {#if job.setups}
                          <em class="partial">
                            {m.timingSetup}
                            {job.setups.map((index) => faDigits(index)).join('، ')}
                          </em>
                        {/if}
                      </strong>
                      <small>
                        <!-- The group header already names the file. It is
                             repeated here only when this run used a different
                             spelling of it, which is the one case where the
                             difference matters. -->
                        {#if job.traceName !== group.name}
                          <span class="ltr">{job.traceName}</span> ·
                        {/if}
                        {formatBytes(job.traceBytes)}
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
                  <!-- Outside the anchor: a button cannot be nested in a link, and
                       deleting must never be one stray click away from opening. -->
                  <button
                    class="delete"
                    type="button"
                    title={busy(job) ? m.historyDeleteBusy : m.historyDelete}
                    aria-label={m.historyDelete}
                    disabled={busy(job) || deleting.includes(job.id)}
                    onclick={() => remove(job)}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
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
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.1rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
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

  .bulk {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    margin-bottom: 0.9rem;
    padding: 0.6rem 0.9rem;
    background: var(--panel-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .bulk .count {
    flex: 1;
    min-width: 8rem;
    font-size: 0.88rem;
    font-weight: 700;
  }

  .danger {
    display: inline-flex;
    gap: 0.45rem;
    align-items: center;
    min-height: 42px;
    padding: 0 1rem;
    color: var(--danger);
    font-weight: 700;
    background: var(--danger-soft);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  .danger:hover:not(:disabled) {
    border-color: var(--danger);
  }

  .danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .groups {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .group {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .group-head {
    display: flex;
    align-items: stretch;
    background: var(--panel-subtle);
    transition: background var(--duration-fast) var(--ease-out);
  }

  .group-head.open {
    border-bottom: 1px solid var(--border);
  }

  .group-head:hover {
    background: color-mix(in srgb, var(--accent) 6%, var(--panel-subtle));
  }

  .disclose {
    display: flex;
    flex: 1;
    gap: 0.7rem;
    align-items: center;
    min-width: 0;
    min-height: 58px;
    padding: 0.6rem 0.5rem 0.6rem 1rem;
    color: inherit;
    text-align: right;
    background: none;
    border: none;
    cursor: pointer;
  }

  .chevron {
    display: inline-grid;
    flex-shrink: 0;
    place-items: center;
    color: var(--muted);
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .title {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    line-height: 1.45;
  }

  .title strong {
    overflow: hidden;
    font-size: 0.98rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .problems {
    display: inline-flex;
    flex-shrink: 0;
    gap: 0.25rem;
    align-items: center;
    padding: 0.2rem 0.6rem;
    color: var(--danger);
    font-size: 0.78rem;
    font-weight: 700;
    background: var(--danger-soft);
    border-radius: 999px;
  }

  .tick {
    flex-shrink: 0;
    align-self: center;
    width: 17px;
    height: 17px;
    margin-inline: 0.9rem 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .tick:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
  }

  li + li {
    border-top: 1px solid var(--border);
  }

  li:has(.delete:hover) .row {
    background: none;
  }

  .row {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    align-items: center;
    min-width: 0;
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

  .delete {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    align-self: stretch;
    width: 48px;
    color: var(--muted);
    background: none;
    border: none;
    border-inline-start: 1px solid var(--border);
    cursor: pointer;
    transition:
      color var(--duration-fast) var(--ease-out),
      background var(--duration-fast) var(--ease-out);
  }

  .delete:hover:not(:disabled) {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .delete:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .error {
    margin-bottom: 0.9rem;
    padding: 0.7rem 0.9rem;
    color: var(--danger);
    font-size: 0.88rem;
    background: var(--danger-soft);
    border-radius: var(--radius-sm);
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

  .partial {
    display: inline-block;
    margin-inline-start: 0.35rem;
    padding: 0.1rem 0.45rem;
    color: var(--warning);
    font-size: 0.72rem;
    font-style: normal;
    vertical-align: middle;
    background: var(--warning-soft);
    border-radius: 999px;
  }

  .names small,
  .title small,
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

    .chevron {
      transition: none;
    }
  }
</style>
