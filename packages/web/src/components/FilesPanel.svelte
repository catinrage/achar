<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Download from 'lucide-svelte/icons/download';
  import Eye from 'lucide-svelte/icons/eye';
  import FileCode from 'lucide-svelte/icons/file-code';
  import FileTerminal from 'lucide-svelte/icons/file-terminal';
  import FolderDown from 'lucide-svelte/icons/folder-down';
  import { api, type JobFile } from '../api';
  import { faDigits, formatBytes } from '../format';
  import { m } from '../messages/fa';

  interface Props {
    jobId: string;
    files: JobFile[];
    onview: (name: string) => void;
  }

  let { jobId, files, onview }: Props = $props();

  const MAIN_PROGRAM = /\.MPF$/i;

  /**
   * Main programs first, then subprograms alphabetically.
   *
   * The `.MPF` is the file the operator actually loads on the control; the
   * `.SPF` subprograms it calls are supporting cast and can run to two hundred
   * entries. Alphabetical order alone buries the one that matters.
   */
  const ordered = $derived(
    [...files].sort((a, b) => {
      const aMain = MAIN_PROGRAM.test(a.name);
      const bMain = MAIN_PROGRAM.test(b.name);
      if (aMain !== bMain) return aMain ? -1 : 1;
      return a.name.localeCompare(b.name, 'en');
    }),
  );

  const isMain = (name: string) => MAIN_PROGRAM.test(name);
</script>

{#if files.length === 0}
  <p class="empty">{m.noFiles}</p>
{:else}
  <div class="bar">
    <span class="count">{faDigits(files.length)} {m.filesWord}</span>
    <a class="primary" href={api.archiveUrl(jobId)}>
      <FolderDown size={18} />
      {m.downloadAll}
    </a>
  </div>

  <ul>
    {#each ordered as file, index (file.name)}
      <li
        class:main={isMain(file.name)}
        in:fly={{ y: 6, duration: 200, delay: Math.min(index, 12) * 18, easing: cubicOut }}
      >
        <span class="actions">
          <button onclick={() => onview(file.name)} title={m.view}>
            <Eye size={16} />
            <span class="wide">{m.view}</span>
          </button>
          <a
            href={api.fileUrl(jobId, file.name)}
            download={file.name}
            title={m.download}
          >
            <Download size={16} />
            <span class="wide">{m.download}</span>
          </a>
        </span>
        <span class="meta">{formatBytes(file.bytes)}</span>
        <span class="meta">{faDigits(file.lines)} {m.fileLines}</span>
        <span class="name mono">
          <span class="icon" aria-hidden="true">
            {#if isMain(file.name)}
              <FileTerminal size={17} />
            {:else}
              <FileCode size={17} />
            {/if}
          </span>
          {file.name}
        </span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    padding: 2.5rem 1rem;
    color: var(--muted);
    text-align: center;
  }

  .bar {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.9rem;
  }

  .count {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .primary {
    display: inline-flex;
    gap: 0.5rem;
    align-items: center;
    min-height: 46px;
    padding: 0 1.15rem;
    color: #fff;
    font-weight: 700;
    text-decoration: none;
    background: var(--accent);
    border-radius: var(--radius-sm);
    transition:
      background var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .primary:hover {
    background: var(--accent-strong);
    transform: translateY(-1px);
  }

  ul {
    margin: 0;
    padding: 0;
    overflow: hidden;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    align-items: center;
    padding: 0.7rem 1rem;
    transition: background var(--duration-fast) var(--ease-out);
  }

  li + li {
    border-top: 1px solid var(--border);
  }

  li:nth-child(odd) {
    background: var(--panel-subtle);
  }

  li:hover {
    background: color-mix(in srgb, var(--accent) 6%, var(--panel));
  }

  /* The one file that goes on the control. */
  li.main .name {
    font-weight: 700;
  }

  li.main .icon {
    color: var(--accent);
  }

  .name {
    display: flex;
    flex: 1;
    gap: 0.55rem;
    align-items: center;
    min-width: 11rem;
    overflow: hidden;
    direction: ltr;
    font-size: 0.9rem;
    /* Truncates from the left, so the distinguishing tail of a long generated
       name stays visible. */
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .icon {
    display: grid;
    flex: none;
    place-items: center;
    color: var(--faint);
  }

  .meta {
    min-width: 5.5rem;
    color: var(--muted);
    font-size: 0.82rem;
    text-align: left;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
  }

  .actions button,
  .actions a {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    min-height: 40px;
    padding: 0 0.85rem;
    color: var(--text);
    font-size: 0.86rem;
    font-weight: 600;
    text-decoration: none;
    background: var(--panel-strong);
    border-radius: var(--radius-sm);
    transition:
      background var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .actions button:hover,
  .actions a:hover {
    color: #fff;
    background: var(--accent);
  }

  .mono {
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }

  /* Below this the labels crowd the row out; the icons still say what each
     button does, and both keep their accessible title. */
  @media (max-width: 620px) {
    .wide {
      display: none;
    }
  }
</style>
