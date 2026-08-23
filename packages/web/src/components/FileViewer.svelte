<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Check from 'lucide-svelte/icons/check';
  import Copy from 'lucide-svelte/icons/copy';
  import Download from 'lucide-svelte/icons/download';
  import X from 'lucide-svelte/icons/x';
  import { api } from '../api';
  import { m } from '../messages/fa';

  interface Props {
    jobId: string;
    name: string;
    onclose: () => void;
  }

  let { jobId, name, onclose }: Props = $props();

  let code = $state<string | null>(null);
  let failed = $state(false);
  let copied = $state(false);

  $effect(() => {
    code = null;
    failed = false;
    api
      .readFile(jobId, name)
      .then((text) => (code = text))
      .catch(() => (failed = true));
  });

  async function copy() {
    if (code === null) return;
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') onclose();
  }}
/>

<div
  class="backdrop"
  role="presentation"
  onclick={onclose}
  transition:fade={{ duration: 140 }}
></div>

<div
  class="sheet"
  role="dialog"
  aria-modal="true"
  aria-label={name}
  transition:scale={{ duration: 180, start: 0.97, opacity: 0, easing: cubicOut }}
>
  <header>
    <strong class="ltr">{name}</strong>
    <div class="actions">
      <button onclick={copy} disabled={code === null}>
        {#if copied}<Check size={15} />{:else}<Copy size={15} />{/if}
        {copied ? m.copied : m.copyCode}
      </button>
      <a class="button" href={api.fileUrl(jobId, name)} download={name}>
        <Download size={15} />
        {m.download}
      </a>
      <button class="close" onclick={onclose} aria-label={m.close}>
        <X size={17} />
      </button>
    </div>
  </header>

  <div class="body">
    {#if failed}
      <p class="state">{m.errorGeneric}</p>
    {:else if code === null}
      <p class="state">…</p>
    {:else}
      <!-- G-code is Latin, fixed-width and line-oriented, so it is laid out
           LTR inside the RTL page. Deliberately not the shared `.ltr` helper:
           that is `display: inline-block`, which would shrink this to its
           content and park it against the right edge. -->
      <pre>{code}</pre>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(8 14 12 / 55%);
    backdrop-filter: blur(2px);
  }

  .sheet {
    position: fixed;
    inset: 5vh 50% auto auto;
    z-index: 41;
    display: flex;
    flex-direction: column;
    width: min(920px, 92vw);
    max-height: 90vh;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    transform: translateX(50%);
  }

  header {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1.1rem;
    border-bottom: 1px solid var(--border);
  }

  .actions {
    display: flex;
    gap: 0.45rem;
    align-items: center;
  }

  .actions button:not(.close),
  .actions .button {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 0 0.9rem;
    color: var(--text);
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    background: var(--panel-strong);
    border-radius: var(--radius-sm);
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    min-height: 40px;
    color: var(--text);
    font-weight: 600;
    background: var(--panel-strong);
    border-radius: var(--radius-sm);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--code-bg);
    border-radius: 0 0 var(--radius) var(--radius);
  }

  pre {
    display: block;
    direction: ltr;
    /* Wider than the pane when lines are long, so the pane scrolls rather than
       the text wrapping mid-block. */
    width: max-content;
    min-width: 100%;
    margin: 0;
    padding: 1.1rem 1.25rem;
    text-align: left;
    color: var(--code-text);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.84rem;
    line-height: 1.7;
    tab-size: 2;
  }

  .state {
    padding: 2rem;
    color: var(--muted);
    text-align: center;
  }
</style>
