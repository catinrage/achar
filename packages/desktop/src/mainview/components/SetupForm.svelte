<script lang="ts">
  import type { DesktopBootstrap, PathKind } from '../../rpc';
  import { faDigits } from '../format';
  import { m } from '../messages/fa';
  import type { FormState } from '../types';

  let {
    formState,
    machineProfiles,
    posts,
    busy,
    activeFixtureRoot,
    onChoosePath,
    onValidate,
    onGenerate,
    onClear,
  }: {
    formState: FormState;
    machineProfiles: DesktopBootstrap['machineProfiles'];
    posts: DesktopBootstrap['posts'];
    busy: boolean;
    activeFixtureRoot: string | undefined;
    onChoosePath: (kind: PathKind) => void;
    onValidate: () => void;
    onGenerate: () => void;
    onClear: () => void;
  } = $props();

  let formElement = $state<HTMLFormElement>();

  function machineProfileLabel(path: string): string {
    const profile = machineProfiles.find((item) => item.path === path);
    if (!profile) return m.profileCustom;
    const name = profile.name ?? profile.id;
    const details = [
      profile.axes ? `${faDigits(profile.axes)} ${m.axes}` : undefined,
      profile.controller,
    ].filter(Boolean);
    return details.length > 0 ? `${name} (${details.join('، ')})` : name;
  }

  function submitValidate(): void {
    if (busy || !formElement?.reportValidity()) return;
    onValidate();
  }

  function submitGenerate(): void {
    if (busy || !formElement?.reportValidity()) return;
    onGenerate();
  }
</script>

<section class="setup-panel" aria-labelledby="setup-heading">
  <div class="section-heading">
    <div>
      <h2 id="setup-heading">{m.setupHeading}</h2>
      <p>{activeFixtureRoot ? m.setupFixtureSelected : m.setupCustomInput}</p>
    </div>
    <button class="text-button" type="button" onclick={onClear}>{m.clear}</button>
  </div>

  <form
    bind:this={formElement}
    onsubmit={(event) => {
      event.preventDefault();
      submitGenerate();
    }}
  >
    <div class="field full-width">
      <label for="trace-path">{m.traceLabel} <span>{m.required}</span></label>
      <div class="path-control">
        <input
          id="trace-path"
          bind:value={formState.tracePath}
          name="tracePath"
          class="ltr-value"
          placeholder={m.tracePlaceholder}
          required
          type="text"
        />
        <button class="browse-button" type="button" onclick={() => onChoosePath('trace')}>{m.browse}</button>
      </div>
    </div>

    <div class="field full-width">
      <label for="vmid-path">{m.vmidLabel}</label>
      <div class="path-control">
        <input
          id="vmid-path"
          bind:value={formState.vmidPath}
          name="vmidPath"
          class="ltr-value"
          placeholder={m.vmidPlaceholder}
          type="text"
        />
        <button class="browse-button" type="button" onclick={() => onChoosePath('vmid')}>{m.browse}</button>
      </div>
    </div>

    <div class="field full-width">
      <label for="profile-path">{m.profileLabel}</label>
      <select
        aria-label={m.profileAriaLabel}
        class="profile-select"
        value={formState.machineProfilePath}
        onchange={(event) => {
          formState.machineProfilePath = event.currentTarget.value;
        }}
      >
        <option value="">{m.profileNone}</option>
        {#each machineProfiles as profile}
          <option value={profile.path}>
            {profile.name ?? profile.id}{profile.axes ? ` / ${faDigits(profile.axes)} ${m.axes}` : ''}{profile.controller
              ? ` / ${profile.controller}`
              : ''}
          </option>
        {/each}
        {#if formState.machineProfilePath && !machineProfiles.some((profile) => profile.path === formState.machineProfilePath)}
          <option value={formState.machineProfilePath}>
            {machineProfileLabel(formState.machineProfilePath)}
          </option>
        {/if}
      </select>
      <div class="path-control">
        <input
          id="profile-path"
          bind:value={formState.machineProfilePath}
          name="machineProfilePath"
          class="ltr-value"
          placeholder={m.profilePlaceholder}
          type="text"
        />
        <button class="browse-button" type="button" onclick={() => onChoosePath('profile')}>{m.browse}</button>
      </div>
    </div>

    <div class="form-row">
      <div class="field">
        <label for="program-name">{m.programNameLabel} <span>{m.required}</span></label>
        <input
          id="program-name"
          bind:value={formState.programName}
          name="programName"
          class="ltr-value"
          placeholder="Setup1"
          required
          type="text"
        />
      </div>
      <div class="field">
        <label for="post-id">{m.postLabel}</label>
        <select id="post-id" bind:value={formState.postId} name="postId">
          {#each posts as post}
            <option value={post.id}>{post.name}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="field full-width">
      <label for="reference-path">{m.referenceLabel}</label>
      <div class="path-control">
        <input
          id="reference-path"
          bind:value={formState.referencePath}
          name="referencePath"
          class="ltr-value"
          placeholder={m.referencePlaceholder}
          type="text"
        />
        <button class="browse-button" type="button" onclick={() => onChoosePath('reference')}>{m.browse}</button>
      </div>
    </div>

    <div class="field full-width">
      <label for="output-path">{m.outputLabel}</label>
      <div class="path-control">
        <input
          id="output-path"
          bind:value={formState.outputPath}
          name="outputPath"
          class="ltr-value"
          placeholder={m.outputPlaceholder}
          type="text"
        />
        <button class="browse-button" type="button" onclick={() => onChoosePath('output')}>{m.browse}</button>
      </div>
    </div>

    <div class="form-note">{m.formNote}</div>

    <div class="form-actions">
      <button class="secondary-button" disabled={busy} type="button" onclick={submitValidate}>{m.validate}</button>
      <button class:loading={busy} class="primary-button" disabled={busy} type="submit">
        <span>{m.generateGcode}</span>
        <span class="button-loader" aria-hidden="true"></span>
      </button>
    </div>
  </form>
</section>
