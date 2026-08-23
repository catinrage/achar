<script lang="ts">
  import type { ProductProfile } from '../api';
  import { faDigits, formatCycleTime, formatNumber } from '../format';
  import { m } from '../messages/fa';

  interface Props {
    profile: ProductProfile | null;
  }

  let { profile }: Props = $props();

  // Longest-running first: that is the order a setter cares about when
  // deciding what to check and stage before starting.
  const tools = $derived(
    [...(profile?.tools ?? [])].sort((a, b) => b.seconds - a.seconds),
  );
</script>

{#if tools.length === 0}
  <p class="empty">{m.toolsUnavailable}</p>
{:else}
  <table>
    <thead>
      <tr>
        <th class="num">{m.toolNumber}</th>
        <th>{m.toolId}</th>
        <th>{m.toolType}</th>
        <th class="num">{m.toolDiameter}</th>
        <th class="num">{m.toolDuration}</th>
      </tr>
    </thead>
    <tbody>
      <!-- Unkeyed: tool ids come from the trace with no uniqueness guarantee. -->
      {#each tools as tool}
        <tr>
          <td class="num">{tool.toolNumber === undefined ? '—' : faDigits(tool.toolNumber)}</td>
          <td>
            <span class="ltr mono">{tool.toolIdString}</span>
            {#if tool.description}
              <small class="ltr">{tool.description}</small>
            {/if}
          </td>
          <td class="type">{tool.userType ?? tool.type ?? '—'}</td>
          <td class="num">
            {tool.diameter === undefined ? '—' : `${formatNumber(tool.diameter, 2)}`}
          </td>
          <td class="num strong">{formatCycleTime(tool.duration)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .empty {
    padding: 2.5rem 1rem;
    color: var(--muted);
    text-align: center;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  th,
  td {
    padding: 0.6rem 0.9rem;
    text-align: right;
    vertical-align: top;
  }

  th {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
    border-bottom: 1px solid var(--border);
  }

  tbody tr + tr td {
    border-top: 1px solid var(--border);
  }

  small {
    display: block;
    color: var(--faint);
    font-size: 0.78rem;
  }

  .type {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .num {
    text-align: left;
    white-space: nowrap;
  }

  .strong {
    font-weight: 700;
  }

  .mono {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.84rem;
  }
</style>
