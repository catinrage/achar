<script lang="ts">
  import { fly } from 'svelte/transition';
  import Boxes from 'lucide-svelte/icons/boxes';
  import CalendarClock from 'lucide-svelte/icons/calendar-clock';
  import Info from 'lucide-svelte/icons/info';
  import type { SetupOverview } from '../api';
  import { faDigits, formatCycleTime, formatPostedAt } from '../format';
  import { fill, m } from '../messages/fa';

  /**
   * Choosing which setups to post.
   *
   * A setup is one physical fixturing of the part, and the operator runs one at
   * a time. The table exists because "setup 2" means nothing on its own — what
   * identifies it at the machine is its fixture, its part home and how long it
   * runs, which is why those columns are here and not in a tooltip.
   *
   * Selection is by index. Names come from SolidCAM and are not guaranteed
   * unique, so the number in the first column is the reliable address, and it
   * is the same number `achar generate --setups` takes.
   */

  interface Props {
    setups: SetupOverview[];
    /** Indices currently ticked. */
    selected: number[];
    hasImplicitSetup: boolean;
    /** The post's own timestamp for this trace, when it carries one. */
    postedAt?: { raw: string; iso?: string } | null;
    keepAllTools: boolean;
    disabled?: boolean;
    onchange: (selected: number[]) => void;
    onkeepalltools: (keep: boolean) => void;
  }

  let {
    setups,
    selected,
    hasImplicitSetup,
    postedAt = null,
    keepAllTools,
    disabled = false,
    onchange,
    onkeepalltools,
  }: Props = $props();

  const chosen = $derived(new Set(selected));
  const allChosen = $derived(
    setups.length > 0 && selected.length === setups.length,
  );
  // Only worth explaining once something has been left out; a full selection
  // posts exactly what it always did.
  const partial = $derived(selected.length > 0 && !allChosen);

  function toggle(index: number) {
    const next = new Set(chosen);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onchange([...next].sort((left, right) => left - right));
  }

  function selectAll() {
    onchange(setups.map((setup) => setup.index));
  }

  function selectNone() {
    onchange([]);
  }
</script>

<section class="picker">
  <header>
    <h3><Boxes size={17} /> {m.setupsTitle}</h3>
    <p>{m.setupsIntro}</p>
  </header>

  <p class="posted">
    <CalendarClock size={14} />
    {postedAt
      ? fill(m.setupsPostedAt, { when: formatPostedAt(postedAt) })
      : m.setupsPostedAtUnknown}
  </p>

  {#if hasImplicitSetup}
    <p class="note"><Info size={15} /> {m.setupsImplicit}</p>
  {/if}

  <div class="bulk">
    <button
      type="button"
      class:active={allChosen}
      {disabled}
      onclick={selectAll}
    >
      {m.setupsAll}
    </button>
    <button
      type="button"
      {disabled}
      onclick={selectNone}
      class:active={selected.length === 0}
    >
      {m.setupsNone}
    </button>
    <span class="count">
      {allChosen
        ? m.setupsAllSelected
        : fill(m.setupsSelectedCount, {
            n: faDigits(selected.length),
            total: faDigits(setups.length),
          })}
    </span>
  </div>

  <ul>
    <li class="head" aria-hidden="true">
      <span class="tick"></span>
      <span class="index">{m.setupsColumnIndex}</span>
      <span class="name">{m.setupsColumnName}</span>
      <span class="cell">{m.setupsColumnFixture}</span>
      <span class="cell">{m.setupsColumnHome}</span>
      <span class="cell">{m.setupsColumnJobs}</span>
      <span class="cell">{m.setupsColumnDuration}</span>
    </li>

    {#each setups as setup (setup.index)}
      {@const isChosen = chosen.has(setup.index)}
      <li class:chosen={isChosen}>
        <label>
          <span class="tick">
            <input
              type="checkbox"
              checked={isChosen}
              {disabled}
              onchange={() => toggle(setup.index)}
            />
          </span>
          <span class="index">{faDigits(setup.index)}</span>
          <span class="name">{setup.name}</span>
          <span class="cell">{setup.fixtureName ?? '—'}</span>
          <span class="cell">
            {setup.partHomeNumber === undefined
              ? '—'
              : faDigits(setup.partHomeNumber)}
          </span>
          <span class="cell">{faDigits(setup.jobCount)}</span>
          <span class="cell duration">{formatCycleTime(setup.duration)}</span>
        </label>
      </li>
    {/each}
  </ul>

  {#if partial}
    <div class="partial" transition:fly={{ y: -6, duration: 180 }}>
      <strong>{m.setupsPartial}</strong>
      <span>
        {fill(m.setupsPartialBody, {
          setups: selected.map((index) => faDigits(index)).join('، '),
        })}
      </span>
      <label class="keep">
        <input
          type="checkbox"
          checked={keepAllTools}
          {disabled}
          onchange={(event) => onkeepalltools(event.currentTarget.checked)}
        />
        <span>
          {m.setupsKeepAllTools}
          <small>{m.setupsKeepAllToolsHint}</small>
        </span>
      </label>
    </div>
  {/if}
</section>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  header h3 {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin: 0;
    font-size: 1rem;
  }

  header h3 :global(svg) {
    color: var(--accent);
  }

  header p {
    margin: 0.3rem 0 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  /* Quieter than .note: this is context, not a warning. It earns a place
     because a trace posted before the CAM project changed reports a setup
     count that is right for the file and wrong for the part, and nothing
     else on screen would give that away. */
  .posted {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
  }

  .posted :global(svg) {
    flex-shrink: 0;
  }

  .note {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    margin: 0;
    padding: 0.7rem 0.9rem;
    color: var(--warning);
    font-size: 0.84rem;
    background: var(--warning-soft);
    border-radius: var(--radius-sm);
  }

  .note :global(svg) {
    flex: none;
    margin-top: 0.15rem;
  }

  .bulk {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .bulk button {
    padding: 0.4rem 0.8rem;
    color: var(--muted);
    font-size: 0.82rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .bulk button:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }

  .bulk button.active {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .count {
    margin-inline-start: auto;
    color: var(--faint);
    font-size: 0.8rem;
  }

  ul {
    margin: 0;
    padding: 0;
    overflow-x: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  li + li {
    border-top: 1px solid var(--border);
  }

  li.head,
  li label {
    display: grid;
    grid-template-columns:
      2.5rem 3rem minmax(7rem, 1.4fr) minmax(6rem, 1fr)
      minmax(5rem, 0.7fr) minmax(4.5rem, 0.7fr) minmax(6rem, 1fr);
    gap: 0.5rem;
    align-items: center;
    min-width: 34rem;
    padding: 0.65rem 0.9rem;
  }

  li.head {
    color: var(--faint);
    font-size: 0.78rem;
    font-weight: 600;
    background: var(--panel-subtle);
  }

  li label {
    cursor: pointer;
  }

  li.chosen {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  li:not(.head):hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .tick {
    display: grid;
    place-items: center;
  }

  .tick input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .index {
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }

  li.chosen .index {
    color: var(--accent);
    font-weight: 700;
  }

  .name {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cell {
    overflow: hidden;
    color: var(--muted);
    font-size: 0.86rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .duration {
    color: var(--text);
  }

  .partial {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    font-size: 0.86rem;
    background: var(--panel-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .partial strong {
    color: var(--warning);
  }

  .keep {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    margin-top: 0.2rem;
    cursor: pointer;
  }

  .keep input {
    margin-top: 0.15rem;
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }

  .keep small {
    display: block;
    color: var(--faint);
    font-size: 0.78rem;
  }
</style>
