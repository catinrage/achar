<script lang="ts">
  import { onMount } from 'svelte';
  import { Electroview } from 'electrobun/view';
  import type {
    AcharDesktopRPC,
    DesktopBootstrap,
    DesktopFixture,
    DesktopInput,
    GenerationResult,
    PathKind,
    ValidationResult,
  } from '../rpc';

  type StatusState = 'neutral' | 'ready' | 'busy' | 'success' | 'error';
  type ThemeMode = 'system' | 'light' | 'dark';
  type FormState = {
    tracePath: string;
    vmidPath: string;
    machineProfilePath: string;
    programName: string;
    referencePath: string;
    outputPath: string;
    postId: string;
  };

  const rpc = Electroview.defineRPC<AcharDesktopRPC>({
    maxRequestTime: 120_000,
    handlers: { requests: {}, messages: {} },
  });
  const app = new Electroview({ rpc });

  let formElement = $state<HTMLFormElement>();
  let bootstrapData = $state<DesktopBootstrap>();
  let activeFixtureRoot = $state<string>();
  let generation = $state<GenerationResult>();
  let busy = $state(false);
  let statusLabel = $state('Connecting');
  let statusState = $state<StatusState>('neutral');
  let errorMessage = $state('');
  let result = $state<ValidationResult | GenerationResult>();
  let preview = $state<GenerationResult['preview']>();
  let activeFile = $state('');
  let theme = $state<ThemeMode>('system');
  let systemTheme = $state<'light' | 'dark'>('dark');
  let copiedMcp = $state(false);

  let formState = $state<FormState>({
    tracePath: '',
    vmidPath: '',
    machineProfilePath: '',
    programName: '',
    referencePath: '',
    outputPath: '',
    postId: '',
  });

  const fixtures = $derived(bootstrapData?.fixtures ?? []);
  const machineProfiles = $derived(bootstrapData?.machineProfiles ?? []);
  const posts = $derived(bootstrapData?.posts ?? []);
  const generatedFiles = $derived(generation?.files ?? []);
  const diagnostics = $derived(result?.diagnostics ?? []);
  const finalTheme = $derived(theme === 'system' ? systemTheme : theme);
  const hasResult = $derived(Boolean(result));
  const mcpCommand = $derived(
    bootstrapData
      ? `${bootstrapData.mcp.command} ${bootstrapData.mcp.args.join(' ')}`
      : 'bun run achar:mcp',
  );

  $effect(() => {
    document.documentElement.dataset.theme = finalTheme;
    document.documentElement.style.colorScheme = finalTheme;
    localStorage.setItem('achar.theme', theme);
  });

  function setStatus(label: string, state: StatusState): void {
    statusLabel = label;
    statusState = state;
  }

  function setBusy(value: boolean, label = 'Working'): void {
    busy = value;
    if (value) setStatus(label, 'busy');
  }

  function setError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
    setStatus('Action failed', 'error');
  }

  function clearError(): void {
    errorMessage = '';
  }

  function collectInput(): DesktopInput {
    return {
      tracePath: formState.tracePath.trim(),
      vmidPath: formState.vmidPath.trim() || undefined,
      machineProfilePath: formState.machineProfilePath.trim() || undefined,
      programName: formState.programName.trim(),
      referencePath: formState.referencePath.trim() || undefined,
      outputPath: formState.outputPath.trim() || undefined,
      postId: formState.postId,
    };
  }

  function setFixture(fixture: DesktopFixture): void {
    activeFixtureRoot = fixture.root;
    formState = {
      tracePath: fixture.tracePath,
      vmidPath: fixture.vmidPath ?? '',
      machineProfilePath: fixture.machineProfilePath ?? '',
      programName: fixture.programName,
      referencePath: fixture.referencePath,
      outputPath: fixture.outputPath ?? '',
      postId: fixture.postId,
    };
    clearError();
  }

  function clearFixture(): void {
    activeFixtureRoot = undefined;
    formState = {
      tracePath: '',
      vmidPath: '',
      machineProfilePath: '',
      programName: '',
      referencePath: '',
      outputPath: '',
      postId: posts[0]?.id ?? '',
    };
    clearError();
  }

  function machineProfileLabel(path: string): string {
    const profile = machineProfiles.find((item) => item.path === path);
    if (!profile) return 'Custom machine profile';
    const name = profile.name ?? profile.id;
    const details = [
      profile.axes ? `${profile.axes} axis` : undefined,
      profile.controller,
    ].filter(Boolean);
    return details.length > 0 ? `${name} (${details.join(', ')})` : name;
  }

  function formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) return `${Math.max(1, Math.round(milliseconds))}ms`;
    return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)}s`;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function parityLabel(value: GenerationResult | undefined): string {
    if (!value || value.matched === undefined) return 'Not run';
    const problems =
      (value.different ?? 0) +
      (value.missingGenerated ?? 0) +
      (value.missingReference ?? 0);
    return problems === 0 ? `${value.matched} matched` : `${problems} issues`;
  }

  function resultSummary(): string {
    if (!result) return 'No generation has run';
    if (generation) {
      return `Generated ${generation.files.length} files in ${formatDuration(generation.durationMs)}`;
    }
    return `Validated ${result.eventCount.toLocaleString()} trace events`;
  }

  async function choosePath(kind: PathKind): Promise<void> {
    if (busy) return;
    try {
      const selected = await app.rpc?.request.choosePath({
        kind,
        startingFolder: bootstrapData?.workspaceRoot,
      });
      if (!selected) return;

      if (kind === 'trace') formState.tracePath = selected;
      if (kind === 'vmid') formState.vmidPath = selected;
      if (kind === 'profile') formState.machineProfilePath = selected;
      if (kind === 'reference') formState.referencePath = selected;
      if (kind === 'output') formState.outputPath = selected;
    } catch (error) {
      setError(error);
    }
  }

  async function validate(): Promise<void> {
    if (busy || !formElement?.reportValidity()) return;
    clearError();
    setBusy(true, 'Validating');
    try {
      const value = await app.rpc?.request.validate(collectInput());
      if (!value) throw new Error('No validation result was returned.');
      result = value;
      generation = undefined;
      preview = {
        file: 'Validation complete',
        code:
          value.diagnostics.length === 0
            ? 'No compatibility issues found.'
            : 'Review diagnostics before generation.',
        truncated: false,
      };
      activeFile = '';
      setStatus(
        value.diagnostics.some((item) => item.severity === 'error')
          ? 'Validation issues'
          : 'Validation passed',
        value.diagnostics.some((item) => item.severity === 'error')
          ? 'error'
          : 'success',
      );
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function generate(): Promise<void> {
    if (busy || !formElement?.reportValidity()) return;
    clearError();
    setBusy(true, 'Generating');
    try {
      const value = await app.rpc?.request.generate(collectInput());
      if (!value) throw new Error('No generation result was returned.');
      result = value;
      generation = value;
      preview = value.preview;
      activeFile = value.preview.file;
      setStatus('Generation complete', 'success');
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function selectGeneratedFile(file: string): Promise<void> {
    if (!generation || busy) return;
    activeFile = file;
    preview = { file, code: 'Loading...', truncated: false };
    try {
      preview = await app.rpc?.request.readOutputFile({
        outputPath: generation.outputPath,
        file,
      });
    } catch (error) {
      setError(error);
    }
  }

  async function openOutput(): Promise<void> {
    if (generation) {
      await app.rpc?.request.openPath({ path: generation.outputPath });
    }
  }

  async function copyMcpCommand(): Promise<void> {
    const env = bootstrapData?.mcp.environment.ACHAR_WORKSPACE
      ? `ACHAR_WORKSPACE=${bootstrapData.mcp.environment.ACHAR_WORKSPACE} `
      : '';
    await navigator.clipboard.writeText(`${env}${mcpCommand}`);
    copiedMcp = true;
    setTimeout(() => {
      copiedMcp = false;
    }, 1600);
  }

  onMount(() => {
    const storedTheme = localStorage.getItem('achar.theme');
    if (
      storedTheme === 'system' ||
      storedTheme === 'light' ||
      storedTheme === 'dark'
    ) {
      theme = storedTheme;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    systemTheme = media.matches ? 'dark' : 'light';
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      systemTheme = event.matches ? 'dark' : 'light';
    };
    media.addEventListener('change', updateSystemTheme);

    void (async () => {
      try {
        const data = await app.rpc?.request.bootstrap({});
        if (!data) throw new Error('Desktop bootstrap returned no data.');
        bootstrapData = data;
        formState.postId = data.posts[0]?.id ?? '';
        if (data.fixtures[0]) setFixture(data.fixtures[0]);
        setStatus('Ready', 'ready');
      } catch (error) {
        setError(error);
      }
    })();

    return () => media.removeEventListener('change', updateSystemTheme);
  });
</script>

<svelte:head>
  <meta name="theme-color" content={finalTheme === 'dark' ? '#101513' : '#f6f8f7'} />
</svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">A</div>
      <div>
        <strong>Achar</strong>
        <span>Post workspace</span>
      </div>
    </div>

    <nav class="primary-nav" aria-label="Primary navigation">
      <button class="nav-item active" type="button">
        <span class="nav-icon">NC</span>
        Generate
      </button>
      <button class="nav-item" type="button">
        <span class="nav-icon">AI</span>
        MCP server
      </button>
    </nav>

    <div class="sidebar-heading">
      <span>Fixtures</span>
      <span class="count">{fixtures.length}</span>
    </div>

    <div class="fixture-list">
      {#each fixtures as fixture}
        <button
          class:active={fixture.root === activeFixtureRoot}
          class="fixture-item"
          type="button"
          onclick={() => setFixture(fixture)}
        >
          <strong>{fixture.programName}</strong>
          <span>{fixture.machineProfilePath ? 'Machine profile attached' : fixture.postId}</span>
        </button>
      {/each}
    </div>

    <div class="mcp-card">
      <div>
        <strong>MCP server</strong>
        <span>Connect LLM clients over stdio</span>
      </div>
      <code>{mcpCommand}</code>
      <button type="button" onclick={copyMcpCommand}>{copiedMcp ? 'Copied' : 'Copy command'}</button>
    </div>

    <div class="sidebar-footer">
      <span title={bootstrapData?.workspaceRoot ?? 'Workspace unavailable'}>
        {bootstrapData?.workspaceRoot ?? 'Workspace unavailable'}
      </span>
      <span>Achar 0.1.0</span>
    </div>
  </aside>

  <main class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow">CNC POST PROCESSOR</p>
        <h1>Generate program</h1>
      </div>
      <div class="topbar-actions">
        <div class="theme-switch" aria-label="Theme">
          {#each ['system', 'light', 'dark'] as mode}
            <button
              class:active={theme === mode}
              type="button"
              onclick={() => {
                theme = mode as ThemeMode;
              }}
            >
              {mode}
            </button>
          {/each}
        </div>
        <div class={`status-pill ${statusState}`}>{statusLabel}</div>
      </div>
    </header>

    <div class="workspace-grid">
      <section class="setup-panel" aria-labelledby="setup-heading">
        <div class="section-heading">
          <div>
            <h2 id="setup-heading">Generation setup</h2>
            <p>{activeFixtureRoot ? 'Fixture selected' : 'Custom inputs'}</p>
          </div>
          <button class="text-button" type="button" onclick={clearFixture}>Clear</button>
        </div>

        <form
          bind:this={formElement}
          onsubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <div class="field full-width">
            <label for="trace-path">Trace 5 file <span>Required</span></label>
            <div class="path-control">
              <input
                id="trace-path"
                bind:value={formState.tracePath}
                name="tracePath"
                placeholder="Select an MPF trace"
                required
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('trace')}>Browse</button>
            </div>
          </div>

          <div class="field full-width">
            <label for="vmid-path">VMID</label>
            <div class="path-control">
              <input
                id="vmid-path"
                bind:value={formState.vmidPath}
                name="vmidPath"
                placeholder="Optional machine definition"
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('vmid')}>Browse</button>
            </div>
          </div>

          <div class="field full-width">
            <label for="profile-path">Machine profile</label>
            <select
              aria-label="Known machine profiles"
              class="profile-select"
              value={formState.machineProfilePath}
              onchange={(event) => {
                formState.machineProfilePath = event.currentTarget.value;
              }}
            >
              <option value="">No machine profile</option>
              {#each machineProfiles as profile}
                <option value={profile.path}>
                  {profile.name ?? profile.id}{profile.axes ? ` / ${profile.axes} axis` : ''}{profile.controller
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
                placeholder="Optional JSON profile"
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('profile')}>Browse</button>
            </div>
          </div>

          <div class="form-row">
            <div class="field">
              <label for="program-name">Program name <span>Required</span></label>
              <input
                id="program-name"
                bind:value={formState.programName}
                name="programName"
                placeholder="Setup1"
                required
                type="text"
              />
            </div>
            <div class="field">
              <label for="post-id">Post</label>
              <select id="post-id" bind:value={formState.postId} name="postId">
                {#each posts as post}
                  <option value={post.id}>{post.name}</option>
                {/each}
              </select>
            </div>
          </div>

          <div class="field full-width">
            <label for="reference-path">Reference output</label>
            <div class="path-control">
              <input
                id="reference-path"
                bind:value={formState.referencePath}
                name="referencePath"
                placeholder="Optional parity directory"
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('reference')}>Browse</button>
            </div>
          </div>

          <div class="field full-width">
            <label for="output-path">Output directory</label>
            <div class="path-control">
              <input
                id="output-path"
                bind:value={formState.outputPath}
                name="outputPath"
                placeholder="Defaults to generated/program-name"
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('output')}>Browse</button>
            </div>
          </div>

          <div class="form-note">
            Machine profiles are optional. Axis compatibility is checked when profile and VMID data are available.
          </div>

          <div class="form-actions">
            <button class="secondary-button" disabled={busy} type="button" onclick={validate}>Validate</button>
            <button class:loading={busy} class="primary-button" disabled={busy} type="submit">
              <span>Generate G-code</span>
              <span class="button-loader" aria-hidden="true"></span>
            </button>
          </div>
        </form>
      </section>

      <section class="results-panel" aria-labelledby="results-heading">
        <div class="results-header">
          <div>
            <h2 id="results-heading">Output</h2>
            <p>{resultSummary()}</p>
          </div>
          <button class="secondary-button compact" disabled={!generation} type="button" onclick={openOutput}>
            Open folder
          </button>
        </div>

        {#if !hasResult}
          <div class="empty-state">
            <div class="empty-glyph">NC</div>
            <h3>Ready to generate</h3>
            <p>Select a fixture or provide a trace, then validate or generate the program.</p>
          </div>
        {:else}
          <div class="result-content">
            <div class="metrics" aria-label="Generation metrics">
              <div class="metric">
                <span>Files</span>
                <strong>{generation?.files.length ?? 0}</strong>
              </div>
              <div class="metric">
                <span>Events</span>
                <strong>{result?.eventCount.toLocaleString() ?? 0}</strong>
              </div>
              <div class="metric">
                <span>Elapsed</span>
                <strong>{result ? formatDuration(result.durationMs) : '0ms'}</strong>
              </div>
              <div class="metric">
                <span>Parity</span>
                <strong>{parityLabel(generation)}</strong>
              </div>
            </div>

            {#if diagnostics.length > 0}
              <div class="diagnostics-section">
                <div class="subheading">
                  <h3>Diagnostics</h3>
                  <span>{diagnostics.length}</span>
                </div>
                <div class="diagnostics-list">
                  {#each diagnostics as diagnostic}
                    <div class={`diagnostic ${diagnostic.severity}`}>
                      <strong>{diagnostic.severity}</strong>
                      <span>{diagnostic.message}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="output-browser">
              <div class="file-column">
                <div class="subheading">
                  <h3>Generated files</h3>
                  <span>{generatedFiles.length}</span>
                </div>
                <div class="file-list">
                  {#each generatedFiles as file}
                    <button
                      class:active={file.file === activeFile}
                      class="file-item"
                      type="button"
                      onclick={() => selectGeneratedFile(file.file)}
                    >
                      <strong>{file.file}</strong>
                      <span>{file.lines.toLocaleString()} lines / {formatBytes(file.bytes)}</span>
                    </button>
                  {/each}
                </div>
              </div>

              <div class="preview-column">
                <div class="preview-toolbar">
                  <span>{preview?.file ?? 'Preview'}</span>
                  <span>{preview?.truncated ? 'Preview truncated' : ''}</span>
                </div>
                <pre tabindex="0">{preview?.code ?? ''}</pre>
              </div>
            </div>
          </div>
        {/if}

        {#if errorMessage}
          <div class="error-banner">
            <strong>Generation failed</strong>
            <span>{errorMessage}</span>
          </div>
        {/if}
      </section>
    </div>
  </main>
</div>
