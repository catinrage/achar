<script lang="ts">
  import { fly, slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Cpu from 'lucide-svelte/icons/cpu';
  import FileCheck from 'lucide-svelte/icons/file-check';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import Save from 'lucide-svelte/icons/save';
  import SlidersHorizontal from 'lucide-svelte/icons/sliders-horizontal';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import X from 'lucide-svelte/icons/x';
  import { ApiError, api, type Machine, type Post } from '../api';
  import Select, { type SelectOption } from '../components/Select.svelte';
  import { m } from '../messages/fa';

  interface Props {
    machines: Machine[];
    onchange: () => void;
  }

  let { machines, onchange }: Props = $props();

  let posts = $state<Post[]>([]);
  let name = $state('');
  let postId = $state('');
  let vmid = $state<File | null>(null);
  let profile = $state<File | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);

  /** The machine being edited, or null while adding a new one. */
  let editing = $state<Machine | null>(null);
  /** Per-document intent while editing: keep what is stored, or remove it. */
  let clearVmid = $state(false);
  let clearProfile = $state(false);

  const postOptions = $derived<SelectOption[]>(
    posts.map((post) => ({ value: post.id, label: post.name })),
  );

  $effect(() => {
    api
      .listPosts()
      .then((loaded) => {
        posts = loaded;
        if (postId === '' && loaded.length > 0) postId = loaded[0]!.id;
      })
      .catch(() => (posts = []));
  });

  function reset() {
    editing = null;
    name = '';
    vmid = null;
    profile = null;
    clearVmid = false;
    clearProfile = false;
    error = null;
    postId = posts[0]?.id ?? '';
  }

  function edit(machine: Machine) {
    editing = machine;
    name = machine.name;
    postId = machine.postId;
    vmid = null;
    profile = null;
    clearVmid = false;
    clearProfile = false;
    error = null;
  }

  async function save() {
    if (!name.trim() || !postId) return;
    saving = true;
    error = null;

    try {
      const form = new FormData();
      form.set('name', name.trim());
      form.set('postId', postId);
      if (vmid) form.set('vmid', vmid);
      if (profile) form.set('machineProfile', profile);

      if (editing) {
        // An absent file means "leave it alone", so removing one has to be
        // said explicitly rather than inferred from the empty field.
        if (clearVmid && !vmid) form.set('clearVmid', 'true');
        if (clearProfile && !profile) form.set('clearProfile', 'true');
        await api.updateMachine(editing.id, form);
      } else {
        await api.createMachine(form);
      }
      reset();
      onchange();
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : m.errorGeneric;
    } finally {
      saving = false;
    }
  }

  async function remove(machine: Machine) {
    if (!confirm(m.machineDeleteConfirm)) return;
    try {
      await api.deleteMachine(machine.id);
      if (editing?.id === machine.id) reset();
      onchange();
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : m.errorGeneric;
    }
  }

  /** Describes what will happen to a stored document when saving. */
  function documentState(
    has: boolean,
    replacement: File | null,
    clear: boolean,
  ): string {
    if (replacement) return m.machineReplaceFile;
    if (!has) return '';
    return clear ? m.machineRemoveFile : m.machineKeepFile;
  }
</script>

<div class="layout">
  <section class="card">
    <h2><Cpu size={18} /> {m.machinesTitle}</h2>
    <p class="intro">{m.machinesIntro}</p>

    {#if machines.length === 0}
      <p class="empty">{m.machinesEmpty}</p>
    {:else}
      <ul>
        {#each machines as machine, index (machine.id)}
          <li
            class:editing={editing?.id === machine.id}
            in:fly={{ y: 8, duration: 200, delay: Math.min(index, 8) * 25, easing: cubicOut }}
          >
            <span class="names">
              <strong>{machine.name}</strong>
              <small>
                {machine.postName}
                {#if machine.hasVmid} · {m.machineHasVmid}{/if}
                {#if machine.hasProfile} · {m.machineHasProfile}{/if}
              </small>
            </span>
            <span class="row-actions">
              <button class="icon-button" onclick={() => edit(machine)} title={m.machineEdit}>
                <Pencil size={16} />
              </button>
              <button
                class="icon-button danger"
                onclick={() => remove(machine)}
                title={m.machineDelete}
              >
                <Trash2 size={16} />
              </button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card">
    <h2>
      {#if editing}
        <Pencil size={17} /> {m.machineEditing}
      {:else}
        <Plus size={18} /> {m.machineAdd}
      {/if}
    </h2>

    <label class="field">
      <span class="field-label">{m.machineNameLabel}</span>
      <input type="text" bind:value={name} placeholder={m.machineNamePlaceholder} />
    </label>

    <div class="field">
      <span class="field-label">{m.machinePostLabel}</span>
      <Select
        value={postId}
        options={postOptions}
        label={m.machinePostLabel}
        onchange={(next) => (postId = next)}
      />
    </div>

    <div class="fields">
      <div class="field">
        <span class="field-label">
          <FileCheck size={15} />
          {m.machineVmidLabel}
        </span>
        <input
          type="file"
          accept=".vmid,.VMID,text/plain"
          onchange={(event) => (vmid = event.currentTarget.files?.[0] ?? null)}
        />
        {#if editing}
          {@const state = documentState(editing.hasVmid, vmid, clearVmid)}
          {#if state}<small transition:slide={{ duration: 150 }}>{state}</small>{/if}
          {#if editing.hasVmid && !vmid}
            <label class="clear">
              <input type="checkbox" bind:checked={clearVmid} />
              {m.machineRemoveFile}
            </label>
          {/if}
        {/if}
      </div>

      <div class="field">
        <span class="field-label">
          <SlidersHorizontal size={15} />
          {m.machineProfileLabel}
        </span>
        <input
          type="file"
          accept=".json,application/json"
          onchange={(event) => (profile = event.currentTarget.files?.[0] ?? null)}
        />
        {#if editing}
          {@const state = documentState(editing.hasProfile, profile, clearProfile)}
          {#if state}<small transition:slide={{ duration: 150 }}>{state}</small>{/if}
          {#if editing.hasProfile && !profile}
            <label class="clear">
              <input type="checkbox" bind:checked={clearProfile} />
              {m.machineRemoveFile}
            </label>
          {/if}
        {/if}
      </div>
    </div>

    {#if error}
      <p class="error" role="alert" transition:fly={{ y: -6, duration: 180 }}>
        {error}
      </p>
    {/if}

    <div class="form-actions">
      <button class="submit" disabled={saving || !name.trim()} onclick={save}>
        {#if editing}
          <Save size={17} />
          {saving ? m.machineSaving : m.machineSave}
        {:else}
          <Plus size={17} />
          {saving ? m.machineAdding : m.machineAdd}
        {/if}
      </button>
      {#if editing}
        <button class="cancel" onclick={reset} transition:fly={{ x: 8, duration: 150 }}>
          <X size={16} />
          {m.machineCancel}
        </button>
      {/if}
    </div>
  </section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1.25rem;
    align-items: start;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.4rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
  }

  h2 {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 1.1rem;
  }

  h2 :global(svg) {
    color: var(--accent);
  }

  .intro {
    margin: -0.5rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .empty {
    padding: 2rem 1rem;
    color: var(--muted);
    text-align: center;
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
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1rem;
    transition: background var(--duration-fast) var(--ease-out);
  }

  li + li {
    border-top: 1px solid var(--border);
  }

  li.editing {
    background: color-mix(in srgb, var(--accent) 9%, var(--panel));
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.4;
  }

  .names small {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .row-actions {
    display: flex;
    flex: none;
    gap: 0.35rem;
  }

  .icon-button {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition:
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .icon-button:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .icon-button.danger:hover {
    color: #fff;
    background: var(--danger);
    border-color: var(--danger);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field-label {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.88rem;
    font-weight: 600;
  }

  .field small {
    color: var(--faint);
    font-size: 0.78rem;
  }

  .clear {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    color: var(--muted);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .clear input {
    accent-color: var(--accent);
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 1rem;
  }

  input[type='text'] {
    min-height: 52px;
    padding: 0 0.9rem;
    background: var(--panel-subtle);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  input[type='text']:hover,
  input[type='text']:focus {
    border-color: var(--accent);
  }

  input[type='file'] {
    padding: 0.7rem;
    font-size: 0.85rem;
    background: var(--panel-subtle);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
  }

  .form-actions {
    display: flex;
    gap: 0.5rem;
  }

  .submit {
    display: inline-flex;
    flex: 1;
    gap: 0.5rem;
    align-items: center;
    justify-content: center;
    min-height: 54px;
    color: #fff;
    font-weight: 700;
    background: var(--accent);
    border-radius: var(--radius-sm);
    transition: background var(--duration-fast) var(--ease-out);
  }

  .submit:hover:not(:disabled) {
    background: var(--accent-strong);
  }

  .submit:disabled {
    color: var(--faint);
    background: var(--panel-strong);
    cursor: default;
  }

  .cancel {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    min-height: 54px;
    padding: 0 1.1rem;
    color: var(--muted);
    font-weight: 600;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .cancel:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }

  .error {
    margin: 0;
    padding: 0.8rem 1rem;
    color: var(--danger);
    background: var(--danger-soft);
    border-radius: var(--radius-sm);
  }
</style>
