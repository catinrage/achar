<script lang="ts">
  import { scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import FileText from 'lucide-svelte/icons/file-text';
  import Upload from 'lucide-svelte/icons/upload';
  import X from 'lucide-svelte/icons/x';
  import { formatBytes } from '../format';
  import { m } from '../messages/fa';

  interface Props {
    file: File | null;
    disabled?: boolean;
    onselect: (file: File | null) => void;
  }

  let { file, disabled = false, onselect }: Props = $props();

  let dragging = $state(false);
  let input = $state<HTMLInputElement | undefined>(undefined);

  function take(list: FileList | null | undefined) {
    const picked = list?.[0];
    if (picked) onselect(picked);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (disabled) return;
    take(event.dataTransfer?.files);
  }
</script>

<div
  class="zone"
  class:dragging
  class:filled={file !== null}
  class:disabled
  ondragover={(event) => {
    event.preventDefault();
    if (!disabled) dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
  role="presentation"
>
  <input
    bind:this={input}
    type="file"
    accept=".MPF,.mpf,.txt,text/plain"
    {disabled}
    onchange={(event) => take(event.currentTarget.files)}
    hidden
  />

  {#if file}
    <div class="chosen">
      <span class="icon" aria-hidden="true" in:scale={{ duration: 220, start: 0.7, easing: cubicOut }}>
        <FileText size={22} />
      </span>
      <span class="chosen-text">
        <strong class="ltr">{file.name}</strong>
        <small>{formatBytes(file.size)}</small>
      </span>
      <button class="ghost" {disabled} onclick={() => onselect(null)}>
        <X size={15} />
        {m.clearFile}
      </button>
    </div>
  {:else}
    <button class="prompt" {disabled} onclick={() => input?.click()}>
      <span class="icon big" aria-hidden="true"><Upload size={30} /></span>
      <strong>{dragging ? m.dropActive : m.dropTitle}</strong>
      <small>{m.dropHint}</small>
    </button>
  {/if}
</div>

<style>
  .zone {
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius);
    background: var(--panel);
    transition: border-color var(--duration-fast) var(--ease-out),
      background var(--duration-fast) var(--ease-out);
  }

  .zone.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  }

  .zone.filled {
    border-style: solid;
    border-color: var(--accent);
  }

  .zone.disabled {
    opacity: 0.6;
  }

  .prompt {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 190px;
    padding: 2rem 1rem;
    text-align: center;
  }

  .prompt strong {
    font-size: 1.1rem;
  }

  .prompt small,
  .chosen small {
    color: var(--muted);
  }

  .icon {
    display: grid;
    place-items: center;
    color: var(--accent);
  }

  .icon.big {
    width: 62px;
    height: 62px;
    margin-bottom: 0.4rem;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-radius: 50%;
    transition:
      transform var(--duration-normal) var(--ease-out),
      background var(--duration-normal) var(--ease-out);
  }

  .zone.dragging .icon.big {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    transform: translateY(-4px) scale(1.06);
  }

  .chosen {
    display: flex;
    gap: 0.9rem;
    align-items: center;
    min-height: 96px;
    padding: 1.1rem 1.25rem;
  }

  .chosen-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    line-height: 1.35;
  }

  .chosen-text strong {
    overflow: hidden;
    font-size: 1rem;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ghost {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    min-height: 44px;
    padding: 0 1rem;
    color: var(--muted);
    font-weight: 600;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .ghost:hover {
    color: var(--danger);
    border-color: var(--danger);
  }
</style>
