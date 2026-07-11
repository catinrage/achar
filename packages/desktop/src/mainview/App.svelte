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
  import McpPanel from './components/McpPanel.svelte';
  import ResultsPanel from './components/ResultsPanel.svelte';
  import SetupForm from './components/SetupForm.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import { m } from './messages/fa';
  import type { ActiveView, FormState } from './types';

  type StatusState = 'neutral' | 'ready' | 'busy' | 'success' | 'error';
  type ThemeMode = 'system' | 'light' | 'dark';

  const THEME_KEY = 'achar.theme';
  const FORM_KEY = 'achar.form';
  const FIXTURE_KEY = 'achar.fixtureRoot';

  const rpc = Electroview.defineRPC<AcharDesktopRPC>({
    maxRequestTime: 120_000,
    handlers: { requests: {}, messages: {} },
  });
  const app = new Electroview({ rpc });

  let bootstrapData = $state<DesktopBootstrap>();
  let activeFixtureRoot = $state<string>();
  let activeView = $state<ActiveView>('generate');
  let generation = $state<GenerationResult>();
  let busy = $state(false);
  let statusLabel = $state(m.statusConnecting);
  let statusState = $state<StatusState>('neutral');
  let errorMessage = $state('');
  let result = $state<ValidationResult | GenerationResult>();
  let preview = $state<GenerationResult['preview']>();
  let activeFile = $state('');
  let theme = $state<ThemeMode>('system');
  let systemTheme = $state<'light' | 'dark'>('dark');
  let copiedMcp = $state(false);
  let restoredForm = $state(false);

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
  const finalTheme = $derived(theme === 'system' ? systemTheme : theme);
  const mcpCommand = $derived(
    bootstrapData
      ? `${bootstrapData.mcp.command} ${bootstrapData.mcp.args.join(' ')}`
      : 'bun run achar:mcp',
  );

  $effect(() => {
    document.documentElement.dataset.theme = finalTheme;
    document.documentElement.style.colorScheme = finalTheme;
    localStorage.setItem(THEME_KEY, theme);
  });

  // Persist the operator's inputs so the next launch starts where they
  // left off instead of resetting to the first fixture.
  $effect(() => {
    const snapshot = JSON.stringify(formState);
    if (!restoredForm) return;
    localStorage.setItem(FORM_KEY, snapshot);
    if (activeFixtureRoot) {
      localStorage.setItem(FIXTURE_KEY, activeFixtureRoot);
    } else {
      localStorage.removeItem(FIXTURE_KEY);
    }
  });

  function setStatus(label: string, state: StatusState): void {
    statusLabel = label;
    statusState = state;
  }

  function setBusy(value: boolean, label = m.statusWorking): void {
    busy = value;
    if (value) setStatus(label, 'busy');
  }

  function setError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
    setStatus(m.statusFailed, 'error');
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
    formState.tracePath = fixture.tracePath;
    formState.vmidPath = fixture.vmidPath ?? '';
    formState.machineProfilePath = fixture.machineProfilePath ?? '';
    formState.programName = fixture.programName;
    formState.referencePath = fixture.referencePath;
    formState.outputPath = fixture.outputPath ?? '';
    formState.postId = fixture.postId;
    clearError();
  }

  function clearFixture(): void {
    activeFixtureRoot = undefined;
    formState.tracePath = '';
    formState.vmidPath = '';
    formState.machineProfilePath = '';
    formState.programName = '';
    formState.referencePath = '';
    formState.outputPath = '';
    formState.postId = posts[0]?.id ?? '';
    clearError();
  }

  function restoreStoredForm(data: DesktopBootstrap): boolean {
    const storedForm = localStorage.getItem(FORM_KEY);
    if (!storedForm) return false;

    try {
      const parsed = JSON.parse(storedForm) as Partial<FormState>;
      if (typeof parsed.tracePath !== 'string' || !parsed.tracePath) {
        return false;
      }
      formState.tracePath = parsed.tracePath;
      formState.vmidPath = parsed.vmidPath ?? '';
      formState.machineProfilePath = parsed.machineProfilePath ?? '';
      formState.programName = parsed.programName ?? '';
      formState.referencePath = parsed.referencePath ?? '';
      formState.outputPath = parsed.outputPath ?? '';
      formState.postId = parsed.postId || (data.posts[0]?.id ?? '');

      const storedFixture = localStorage.getItem(FIXTURE_KEY);
      if (
        storedFixture &&
        data.fixtures.some((fixture) => fixture.root === storedFixture)
      ) {
        activeFixtureRoot = storedFixture;
      }
      return true;
    } catch {
      return false;
    }
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
    if (busy) return;
    clearError();
    setBusy(true, m.statusValidating);
    try {
      const value = await app.rpc?.request.validate(collectInput());
      if (!value) throw new Error(m.noValidationResult);
      result = value;
      generation = undefined;
      preview = {
        file: m.validationResultFile,
        code:
          value.diagnostics.length === 0
            ? m.validationNoIssues
            : m.validationReviewIssues,
        truncated: false,
      };
      activeFile = '';
      const hasErrors = value.diagnostics.some(
        (item) => item.severity === 'error',
      );
      setStatus(
        hasErrors ? m.statusValidationIssues : m.statusValidationPassed,
        hasErrors ? 'error' : 'success',
      );
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function generate(): Promise<void> {
    if (busy) return;
    clearError();
    setBusy(true, m.statusGenerating);
    try {
      const value = await app.rpc?.request.generate(collectInput());
      if (!value) throw new Error(m.noGenerationResult);
      result = value;
      generation = value;
      preview = value.preview;
      activeFile = value.preview.file;
      setStatus(m.statusGenerationDone, 'success');
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function selectGeneratedFile(file: string): Promise<void> {
    if (!generation || busy) return;
    activeFile = file;
    preview = { file, code: m.loading, truncated: false };
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
    const storedTheme = localStorage.getItem(THEME_KEY);
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
        if (!data) throw new Error(m.noBootstrapData);
        bootstrapData = data;
        formState.postId = data.posts[0]?.id ?? '';
        if (!restoreStoredForm(data) && data.fixtures[0]) {
          setFixture(data.fixtures[0]);
        }
        restoredForm = true;
        setStatus(m.statusReady, 'ready');
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
  <Sidebar
    {fixtures}
    {activeFixtureRoot}
    {activeView}
    {mcpCommand}
    {copiedMcp}
    workspaceRoot={bootstrapData?.workspaceRoot}
    onSelectFixture={(fixture) => {
      activeView = 'generate';
      setFixture(fixture);
    }}
    onNavigate={(view) => {
      activeView = view;
    }}
    onCopyMcp={copyMcpCommand}
  />

  <main class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow">{m.eyebrow}</p>
        <h1>{activeView === 'mcp' ? m.pageTitleMcp : m.pageTitleGenerate}</h1>
      </div>
      <div class="topbar-actions">
        <div class="theme-switch" aria-label={m.themeAriaLabel}>
          <button
            class:active={theme === 'system'}
            type="button"
            title={m.themeSystem}
            aria-label={m.themeSystem}
            onclick={() => {
              theme = 'system';
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
          </button>
          <button
            class:active={theme === 'light'}
            type="button"
            title={m.themeLight}
            aria-label={m.themeLight}
            onclick={() => {
              theme = 'light';
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.9 4.9 1.4 1.4" />
              <path d="m17.7 17.7 1.4 1.4" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.3 17.7-1.4 1.4" />
              <path d="m19.1 4.9-1.4 1.4" />
            </svg>
          </button>
          <button
            class:active={theme === 'dark'}
            type="button"
            title={m.themeDark}
            aria-label={m.themeDark}
            onclick={() => {
              theme = 'dark';
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          </button>
        </div>
        <div class={`status-pill ${statusState}`}>{statusLabel}</div>
      </div>
    </header>

    {#if activeView === 'mcp'}
      <div class="workspace-single">
        <McpPanel
          {mcpCommand}
          environment={bootstrapData?.mcp.environment ?? {}}
          {copiedMcp}
          onCopyMcp={copyMcpCommand}
        />
      </div>
    {:else}
      <div class="workspace-grid">
        <SetupForm
          {formState}
          {machineProfiles}
          {posts}
          {busy}
          {activeFixtureRoot}
          onChoosePath={(kind) => void choosePath(kind)}
          onValidate={() => void validate()}
          onGenerate={() => void generate()}
          onClear={clearFixture}
        />
        <ResultsPanel
          {result}
          {generation}
          {preview}
          {activeFile}
          {errorMessage}
          onSelectFile={(file) => void selectGeneratedFile(file)}
          onOpenOutput={() => void openOutput()}
        />
      </div>
    {/if}
  </main>
</div>
