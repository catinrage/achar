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
  import {
    ApiError,
    api,
    type Machine,
    type MachineFeatureSpec,
    type MachineProfile,
    type Post,
  } from '../api';
  import Select, { type SelectOption } from '../components/Select.svelte';
  import { m, machineFeatureText } from '../messages/fa';

  /**
   * Defining a machine.
   *
   * A machine used to be a name plus two files to upload, one of which — the
   * profile — is a document this application owns and nobody wants to hand-
   * write. It is a record now: every property is a field, the boolean ones are
   * three-way because "says nothing" and "says no" are genuinely different
   * answers, and the JSON is only there to be read.
   *
   * The property fields are rendered from the schema `GET /api/posts` serves,
   * so a property added to core's table appears here with the row that
   * declares it.
   */

  interface Props {
    machines: Machine[];
    onchange: () => void;
  }

  let { machines, onchange }: Props = $props();

  /** A boolean machine property: unset, or an explicit yes or no. */
  type Tristate = 'default' | 'true' | 'false';

  interface Draft {
    name: string;
    postId: string;
    dialect: string;
    axes: string;
    extends: string;
    features: Record<string, string>;
    home: { x: string; y: string; z: string };
    returnHome: { x: string; y: string; z: string };
  }

  let posts = $state<Post[]>([]);
  let features = $state<MachineFeatureSpec[]>([]);
  let draft = $state<Draft>(blankDraft());
  let vmid = $state<File | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);

  /** The machine being edited, or null while adding a new one. */
  let editing = $state<Machine | null>(null);
  /** Whether to remove the stored VMID on save. */
  let clearVmid = $state(false);

  const post = $derived(posts.find((entry) => entry.id === draft.postId));

  const postOptions = $derived<SelectOption[]>(
    posts.map((entry) => ({ value: entry.id, label: entry.name })),
  );

  const dialectOptions = $derived<SelectOption[]>([
    { value: '', label: m.machineDialectDefault },
    ...(post?.dialects ?? []).map((dialect) => ({
      value: dialect,
      label: dialect,
    })),
  ]);

  // A machine cannot be its own base, and the server refuses it anyway; the
  // list simply does not offer it.
  const baseOptions = $derived<SelectOption[]>([
    { value: '', label: m.machineExtendsNone },
    ...machines
      .filter((machine) => machine.id !== editing?.id)
      .map((machine) => ({ value: machine.id, label: machine.name })),
  ]);

  /** The profile document this form describes, or null when it says nothing. */
  const profile = $derived(composeProfile(draft));

  $effect(() => {
    api
      .listPosts()
      .then((loaded) => {
        posts = loaded.posts;
        features = loaded.machineFeatures;
        if (draft.postId === '' && loaded.posts.length > 0) {
          draft = { ...draft, postId: loaded.posts[0]!.id };
        }
      })
      .catch(() => {
        posts = [];
        features = [];
      });
  });

  function blankDraft(): Draft {
    return {
      name: '',
      postId: posts[0]?.id ?? '',
      dialect: '',
      axes: '',
      extends: '',
      features: {},
      home: { x: '', y: '', z: '' },
      returnHome: { x: '', y: '', z: '' },
    };
  }

  /** Fills the form from a stored profile, field by field. */
  function draftFrom(machine: Machine): Draft {
    const stored: MachineProfile | null = machine.profile;
    const featureValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(stored?.features ?? {})) {
      featureValues[key] = String(value);
    }

    return {
      name: machine.name,
      postId: machine.postId,
      dialect: stored?.dialect ?? '',
      axes: stored?.axes === undefined ? '' : String(stored.axes),
      extends: stored?.extends ?? '',
      features: featureValues,
      home: coordinates(stored?.home),
      returnHome: coordinates(stored?.returnHome),
    };
  }

  function coordinates(position: MachineProfile['home']) {
    return {
      x: position?.x === undefined ? '' : String(position.x),
      y: position?.y === undefined ? '' : String(position.y),
      z: position?.z === undefined ? '' : String(position.z),
    };
  }

  function reset() {
    editing = null;
    vmid = null;
    clearVmid = false;
    error = null;
    draft = blankDraft();
  }

  function edit(machine: Machine) {
    editing = machine;
    draft = draftFrom(machine);
    vmid = null;
    clearVmid = false;
    error = null;
  }

  /**
   * Turns the form into the profile document.
   *
   * Nothing is invented: a field left blank is left out, so the post applies
   * its own default rather than being told a value the admin never chose. The
   * controller is not sent at all — it belongs to the post, which already
   * knows it, and a second copy could only ever disagree.
   */
  function composeProfile(current: Draft): Record<string, unknown> | null {
    const document: Record<string, unknown> = {};

    if (current.dialect) document.dialect = current.dialect;
    if (current.extends) document.extends = current.extends;

    const axes = numberOf(current.axes);
    if (axes !== undefined) document.axes = axes;

    const featureValues = composeFeatures(current);
    if (Object.keys(featureValues).length > 0) document.features = featureValues;

    const home = composeHome(current.home);
    if (home) document.home = home;
    const returnHome = composeHome(current.returnHome);
    if (returnHome) document.returnHome = returnHome;

    return Object.keys(document).length > 0 ? document : null;
  }

  function composeFeatures(current: Draft): Record<string, unknown> {
    const values: Record<string, unknown> = {};

    for (const spec of features) {
      const raw = current.features[spec.key];
      if (raw === undefined || raw === '' || raw === 'default') continue;

      if (spec.kind === 'boolean') values[spec.key] = raw === 'true';
      else if (spec.kind === 'number') {
        const parsed = numberOf(raw);
        if (parsed !== undefined) values[spec.key] = parsed;
      } else values[spec.key] = raw;
    }

    return values;
  }

  function composeHome(position: {
    x: string;
    y: string;
    z: string;
  }): Record<string, number> | null {
    const values: Record<string, number> = {};
    for (const axis of ['x', 'y', 'z'] as const) {
      const parsed = numberOf(position[axis]);
      if (parsed !== undefined) values[axis] = parsed;
    }
    return Object.keys(values).length > 0 ? values : null;
  }

  function numberOf(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /** A property's Persian name, falling back to what core's schema carries. */
  function featureText(spec: MachineFeatureSpec) {
    return machineFeatureText[spec.key] ?? spec;
  }

  function tristate(key: string): Tristate {
    const value = draft.features[key];
    return value === 'true' || value === 'false' ? value : 'default';
  }

  function setFeature(key: string, value: string) {
    draft = { ...draft, features: { ...draft.features, [key]: value } };
  }

  async function save() {
    if (!draft.name.trim() || !draft.postId) return;
    saving = true;
    error = null;

    try {
      const form = new FormData();
      form.set('name', draft.name.trim());
      form.set('postId', draft.postId);
      if (vmid) form.set('vmid', vmid);

      // Always sent, including when empty: on an edit, "the form now says
      // nothing" has to be able to clear a profile that used to say something.
      if (profile) form.set('machineProfile', JSON.stringify(profile));
      else if (editing) form.set('clearProfile', 'true');

      if (editing) {
        // An absent file means "leave it alone", so removing one has to be
        // said explicitly rather than inferred from the empty field.
        if (clearVmid && !vmid) form.set('clearVmid', 'true');
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

  /** Describes what will happen to the stored VMID when saving. */
  function vmidState(): string {
    if (vmid) return m.machineReplaceFile;
    if (!editing?.hasVmid) return '';
    return clearVmid ? m.machineRemoveFile : m.machineKeepFile;
  }
</script>

<div class="layout">
  <section class="card">
    <h2><Cpu size={18} /> {m.machinesTitle}</h2>
    <p class="intro">{m.machinesIntro}</p>

    {#if machines.length === 0}
      <p class="empty">{m.machinesEmpty}</p>
    {:else}
      <ul class="machines">
        {#each machines as machine, index (machine.id)}
          <li
            class:editing={editing?.id === machine.id}
            in:fly={{
              y: 8,
              duration: 200,
              delay: Math.min(index, 8) * 25,
              easing: cubicOut,
            }}
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
              <button
                class="icon-button"
                onclick={() => edit(machine)}
                title={m.machineEdit}
              >
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
      <input
        type="text"
        bind:value={draft.name}
        placeholder={m.machineNamePlaceholder}
      />
    </label>

    <div class="field">
      <span class="field-label">{m.machinePostLabel}</span>
      <Select
        value={draft.postId}
        options={postOptions}
        label={m.machinePostLabel}
        onchange={(next) => (draft = { ...draft, postId: next })}
      />
      {#if post}
        <small>
          {m.machineControllerLabel}: <span class="ltr">{post.controller}</span>
          — {m.machineControllerAuto}
        </small>
      {/if}
    </div>

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
        {@const state = vmidState()}
        {#if state}
          <small transition:slide={{ duration: 150 }}>{state}</small>
        {/if}
        {#if editing.hasVmid && !vmid}
          <label class="checkbox">
            <input type="checkbox" bind:checked={clearVmid} />
            {m.machineRemoveFile}
          </label>
        {/if}
      {/if}
    </div>

    <div class="section">
      <h3><SlidersHorizontal size={16} /> {m.machineProfileLabel}</h3>
      <p class="intro">{m.machineProfileIntro}</p>

      <div class="fields">
        <div class="field">
          <span class="field-label">{m.machineDialectLabel}</span>
          <Select
            value={draft.dialect}
            options={dialectOptions}
            label={m.machineDialectLabel}
            onchange={(next) => (draft = { ...draft, dialect: next })}
          />
          <small>{m.machineDialectHint}</small>
        </div>

        <label class="field">
          <span class="field-label">{m.machineAxesLabel}</span>
          <input
            class="ltr"
            type="number"
            min="1"
            step="1"
            bind:value={draft.axes}
            placeholder={m.machineFeatureUnset}
          />
        </label>

        <div class="field">
          <span class="field-label">{m.machineExtendsLabel}</span>
          <Select
            value={draft.extends}
            options={baseOptions}
            label={m.machineExtendsLabel}
            onchange={(next) => (draft = { ...draft, extends: next })}
          />
          <small>{m.machineExtendsHint}</small>
        </div>
      </div>

      <div class="fields wide">
        {#each [{ label: m.machineHomeLabel, key: 'home' }, { label: m.machineReturnHomeLabel, key: 'returnHome' }] as position (position.key)}
          <div class="field">
            <span class="field-label">{position.label}</span>
            <div class="axes">
              {#each ['x', 'y', 'z'] as axis (axis)}
                <label class="axis">
                  <span>{axis.toUpperCase()}</span>
                  <input
                    class="ltr"
                    type="number"
                    step="0.001"
                    placeholder={m.machineFeatureUnset}
                    value={position.key === 'home'
                      ? draft.home[axis as 'x']
                      : draft.returnHome[axis as 'x']}
                    oninput={(event) => {
                      const value = event.currentTarget.value;
                      draft =
                        position.key === 'home'
                          ? { ...draft, home: { ...draft.home, [axis]: value } }
                          : {
                              ...draft,
                              returnHome: {
                                ...draft.returnHome,
                                [axis]: value,
                              },
                            };
                    }}
                  />
                </label>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <small class="hint">{m.machineHomeHint}</small>

      <h4>{m.machineFeaturesLabel}</h4>
      <ul class="features">
        {#each features as spec (spec.key)}
          {@const text = featureText(spec)}
          <li>
            <div class="feature-text">
              <strong>{text.label}</strong>
              <small>{text.description}</small>
            </div>

            {#if spec.kind === 'boolean'}
              <div class="tristate" role="radiogroup" aria-label={text.label}>
                {#each [{ value: 'default', label: m.machineFeatureDefault }, { value: 'true', label: m.machineFeatureYes }, { value: 'false', label: m.machineFeatureNo }] as option (option.value)}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={tristate(spec.key) === option.value}
                    class:on={tristate(spec.key) === option.value}
                    onclick={() => setFeature(spec.key, option.value)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            {:else if spec.kind === 'number'}
              <label class="feature-input">
                <input
                  class="ltr"
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.integer ? 1 : 'any'}
                  placeholder={m.machineFeatureUnset}
                  value={draft.features[spec.key] ?? ''}
                  oninput={(event) =>
                    setFeature(spec.key, event.currentTarget.value)}
                />
                {#if spec.unit}<span class="unit">{spec.unit}</span>{/if}
              </label>
            {:else}
              <div class="feature-input">
                <Select
                  value={draft.features[spec.key] ?? ''}
                  options={[
                    { value: '', label: m.machineFeatureDefault },
                    ...spec.values.map((value) => ({ value, label: value })),
                  ]}
                  label={text.label}
                  onchange={(next) => setFeature(spec.key, next)}
                />
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      <details class="advanced">
        <summary>{m.machineAdvanced}</summary>
        <p class="hint">{m.machineAdvancedHint}</p>
        <pre class="ltr">{profile
            ? JSON.stringify(profile, null, 2)
            : m.machineNoProfile}</pre>
      </details>
    </div>

    {#if error}
      <p class="error" role="alert" transition:fly={{ y: -6, duration: 180 }}>
        {error}
      </p>
    {/if}

    <div class="form-actions">
      <button class="submit" disabled={saving || !draft.name.trim()} onclick={save}>
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
    grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
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

  h3 {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin: 0;
    font-size: 0.98rem;
  }

  h4 {
    margin: 0.4rem 0 0;
    color: var(--muted);
    font-size: 0.86rem;
  }

  h2 :global(svg),
  h3 :global(svg) {
    color: var(--accent);
  }

  .intro {
    margin: -0.5rem 0 0;
    color: var(--muted);
    font-size: 0.86rem;
  }

  .section .intro {
    margin: 0;
  }

  .empty {
    padding: 2rem 1rem;
    color: var(--muted);
    text-align: center;
  }

  ul.machines {
    margin: 0;
    padding: 0;
    overflow: hidden;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  ul.machines li {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1rem;
    transition: background var(--duration-fast) var(--ease-out);
  }

  ul.machines li + li {
    border-top: 1px solid var(--border);
  }

  ul.machines li.editing {
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

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1.1rem;
    background: var(--panel-subtle);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .card,
  .section,
  .field {
    /* Grid and flex children default to a min-content floor, and a number
       input's min-content is wide. Without this the three axis boxes push the
       form past its column and the machine list off the page. */
    min-width: 0;
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

  .field small,
  .hint {
    color: var(--faint);
    font-size: 0.78rem;
  }

  .hint {
    margin: -0.4rem 0 0;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    gap: 1rem;
  }

  .fields.wide {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  }

  .checkbox {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    color: var(--muted);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .checkbox input {
    accent-color: var(--accent);
  }

  .axes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4rem;
  }

  .axis {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .axis span {
    color: var(--faint);
    font-size: 0.72rem;
    font-weight: 700;
  }

  ul.features {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  ul.features li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 0;
  }

  ul.features li + li {
    border-top: 1px solid var(--border);
  }

  .feature-text {
    display: flex;
    flex-direction: column;
    flex: 1 1 12rem;
    min-width: 0;
    gap: 0.15rem;
  }

  .feature-text strong {
    font-size: 0.88rem;
  }

  .feature-text small {
    color: var(--faint);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .tristate {
    display: inline-flex;
    flex: none;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }

  .tristate button {
    padding: 0.45rem 0.7rem;
    color: var(--muted);
    font-size: 0.8rem;
    transition:
      color var(--duration-fast) var(--ease-out),
      background var(--duration-fast) var(--ease-out);
  }

  .tristate button + button {
    border-inline-start: 1px solid var(--border);
  }

  .tristate button:hover {
    color: var(--text);
  }

  .tristate button.on {
    color: #fff;
    background: var(--accent);
  }

  .feature-input {
    display: inline-flex;
    flex: none;
    gap: 0.4rem;
    align-items: center;
    min-width: 9rem;
  }

  .unit {
    color: var(--faint);
    font-size: 0.78rem;
  }

  .advanced summary {
    color: var(--muted);
    font-size: 0.82rem;
    cursor: pointer;
  }

  .advanced pre {
    max-height: 18rem;
    margin: 0.5rem 0 0;
    padding: 0.8rem;
    overflow: auto;
    color: var(--muted);
    font-size: 0.78rem;
    background: var(--panel-strong);
    border-radius: var(--radius-sm);
  }

  input[type='text'],
  input[type='number'] {
    width: 100%;
    min-width: 0;
    min-height: 48px;
    padding: 0 0.9rem;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    transition: border-color var(--duration-fast) var(--ease-out);
  }

  input[type='text']:hover,
  input[type='text']:focus,
  input[type='number']:hover,
  input[type='number']:focus {
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
