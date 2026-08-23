<script lang="ts">
  import type { Diagnostic } from '../api';
  import { slide } from 'svelte/transition';
  import CircleAlert from 'lucide-svelte/icons/circle-alert';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { faDigits } from '../format';
  import { fill, m } from '../messages/fa';

  interface Props {
    diagnostics: Diagnostic[];
    blocked: boolean;
  }

  let { diagnostics, blocked }: Props = $props();

  const errors = $derived(diagnostics.filter((d) => d.severity === 'error'));
  const warnings = $derived(diagnostics.filter((d) => d.severity !== 'error'));

  /**
   * Warnings collapse past a handful.
   *
   * A trace routinely carries a dozen "parameter not declared in the VMID"
   * notes. Listing them all pushes the generated files — the thing the
   * operator actually came for — off the screen, so they fold away behind a
   * count. Errors never collapse: those are the reason there is no G-code.
   */
  const COLLAPSE_ABOVE = 3;
  const collapsible = $derived(warnings.length > COLLAPSE_ABOVE);

  /**
   * The short identifier shown beside a message.
   *
   * Product-profile findings carry a `code`; VMID and machine-profile findings
   * instead name where in the trace they were raised. One or the other is
   * always present, never both.
   */
  function label(diagnostic: Diagnostic): string | null {
    if (diagnostic.code) return diagnostic.code;
    if (diagnostic.event && diagnostic.key) {
      return `${diagnostic.event}.${diagnostic.key}`;
    }
    return diagnostic.event ?? diagnostic.key ?? null;
  }
</script>

{#if errors.length > 0}
  <section class="panel error" aria-live="polite">
    <h3><CircleAlert size={17} /> {m.blockedTitle}</h3>
    <p>{m.blockedBody}</p>
    <ul>
      <!-- Unkeyed on purpose: a finished job's diagnostics never reorder, and
           two findings can share a message — the same undeclared VMID
           parameter is reported once for Line and once for Arc — so any
           content-derived key would collide. -->
      {#each errors as diagnostic}
        <li>
          {#if label(diagnostic)}
            <code class="ltr">{label(diagnostic)}</code>
          {/if}
          <!-- Core's diagnostics name trace events, axes and VMID parameters
               verbatim, so they stay in English to remain greppable. -->
          <span class="ltr detail">{diagnostic.message}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if warnings.length > 0}
  <section class="panel warning">
    {#if collapsible}
      <details>
        <summary>
          <TriangleAlert size={16} />
          <span class="summary-title">{m.warningsTitle}</span>
          <span class="badge">
            {fill(m.warningsCount, { n: faDigits(warnings.length) })}
          </span>
        </summary>
        <div transition:slide={{ duration: 180 }}>
          {#if !blocked}<p>{m.warningsBody}</p>{/if}
          {@render list(warnings)}
        </div>
      </details>
    {:else}
      <h3><TriangleAlert size={16} /> {m.warningsTitle}</h3>
      {#if !blocked}<p>{m.warningsBody}</p>{/if}
      {@render list(warnings)}
    {/if}
  </section>
{/if}

{#snippet list(entries: Diagnostic[])}
  <ul>
    {#each entries as diagnostic}
      <li>
        {#if label(diagnostic)}
          <code class="ltr">{label(diagnostic)}</code>
        {/if}
        <span class="ltr detail">{diagnostic.message}</span>
      </li>
    {/each}
  </ul>
{/snippet}

<style>
  .panel {
    padding: 1.1rem 1.25rem;
    border: 1px solid;
    border-radius: var(--radius);
  }

  .panel + :global(.panel) {
    margin-top: 0.85rem;
  }

  .panel h3 {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    font-size: 1rem;
  }

  .panel p {
    margin: 0.3rem 0 0.75rem;
    color: var(--muted);
    font-size: 0.92rem;
  }

  .error {
    background: var(--danger-soft);
    border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  }

  .error h3 {
    color: var(--danger);
  }

  .warning {
    background: var(--warning-soft);
    border-color: color-mix(in srgb, var(--warning) 35%, transparent);
  }

  .warning h3 {
    color: var(--warning);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
  }

  code {
    padding: 0.1rem 0.45rem;
    font-size: 0.78rem;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    border-radius: 5px;
  }

  .detail {
    flex: 1;
    min-width: 12rem;
    font-size: 0.9rem;
  }

  summary {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    min-height: 32px;
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .summary-title {
    color: var(--warning);
    font-weight: 700;
  }

  /* A disclosure triangle that points the right way in an RTL column. */
  summary::before {
    content: '\25c0';
    color: var(--warning);
    font-size: 0.7rem;
    transition: transform var(--duration-fast) var(--ease-out);
  }

  details[open] summary::before {
    transform: rotate(-90deg);
  }

  .badge {
    padding: 0.05rem 0.5rem;
    color: var(--warning);
    font-size: 0.78rem;
    background: color-mix(in srgb, var(--warning) 15%, transparent);
    border-radius: 999px;
  }

  details[open] p {
    margin-top: 0.6rem;
  }
</style>
