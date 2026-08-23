<script lang="ts">
  import type { TimingReport } from '../api';
  import { faDigits, formatCycleTime } from '../format';
  import { m } from '../messages/fa';

  interface Props {
    timing: TimingReport | null;
  }

  let { timing }: Props = $props();
</script>

{#if !timing || timing.setups.length === 0}
  <p class="empty">{m.timingUnavailable}</p>
{:else}
  <div class="total">
    <span>{m.timingTotal}</span>
    <strong>{formatCycleTime(timing.duration)}</strong>
  </div>

  <!-- Unkeyed: setup names are not unique — core raises `duplicate-setup-name`
       precisely because a trace can repeat them. -->
  {#each timing.setups as setup}
    <section class="setup">
      <header>
        <h4>{setup.name}</h4>
        <span class="duration">{formatCycleTime(setup.duration)}</span>
      </header>

      {#if setup.jobs.length > 0}
        <table>
          <thead>
            <tr>
              <th>{m.timingJob}</th>
              <th>{m.timingTool}</th>
              <th class="num">{m.timingInstances}</th>
              <th class="num">{m.timingCutting}</th>
              <th class="num">{m.timingDuration}</th>
            </tr>
          </thead>
          <tbody>
            {#each setup.jobs as job, index (job.name + index)}
              <tr>
                <td>{job.name}</td>
                <td class="ltr mono">{job.tool ?? '—'}</td>
                <td class="num">{faDigits(job.instances)}</td>
                <td class="num">{formatCycleTime(secondsToClock(job.cuttingSeconds))}</td>
                <td class="num strong">{formatCycleTime(job.duration)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/each}
{/if}

<script lang="ts" module>
  /** Core reports per-job cutting time in seconds; the table shows clocks. */
  export function secondsToClock(seconds: number): string {
    const whole = Math.max(0, Math.round(seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  }
</script>

<style>
  .empty {
    padding: 2.5rem 1rem;
    color: var(--muted);
    text-align: center;
  }

  .total {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    color: #fff;
    background: linear-gradient(120deg, var(--accent-strong), var(--accent));
    border-radius: var(--radius);
  }

  .total strong {
    font-size: 1.45rem;
  }

  .setup {
    margin-top: 1rem;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .setup header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.8rem 1.1rem;
    background: var(--panel-subtle);
    border-bottom: 1px solid var(--border);
  }

  h4 {
    margin: 0;
    font-size: 0.98rem;
  }

  .duration {
    color: var(--accent);
    font-weight: 700;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }

  th,
  td {
    padding: 0.55rem 1.1rem;
    text-align: right;
  }

  th {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
  }

  tbody tr + tr td {
    border-top: 1px solid var(--border);
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
    font-size: 0.82rem;
  }
</style>
