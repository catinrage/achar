<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
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
  let statusLabel = $state('در حال اتصال');
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

  function faDigits(value: string | number): string {
    return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  }

  function setStatus(label: string, state: StatusState): void {
    statusLabel = label;
    statusState = state;
  }

  function setBusy(value: boolean, label = 'در حال پردازش'): void {
    busy = value;
    if (value) setStatus(label, 'busy');
  }

  function setError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
    setStatus('عملیات ناموفق', 'error');
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
    if (!profile) return 'پروفایل ماشین سفارشی';
    const name = profile.name ?? profile.id;
    const details = [
      profile.axes ? `${faDigits(profile.axes)} محوره` : undefined,
      profile.controller,
    ].filter(Boolean);
    return details.length > 0 ? `${name} (${details.join('، ')})` : name;
  }

  function formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) {
      return `${faDigits(Math.max(1, Math.round(milliseconds)))} میلی‌ثانیه`;
    }
    const seconds = (milliseconds / 1000).toFixed(
      milliseconds < 10_000 ? 2 : 1,
    );
    return `${faDigits(seconds)} ثانیه`;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${faDigits(bytes)} بایت`;
    if (bytes < 1024 * 1024) {
      return `${faDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
    }
    return `${faDigits((bytes / 1024 / 1024).toFixed(1))} مگابایت`;
  }

  function parityLabel(value: GenerationResult | undefined): string {
    if (!value || value.matched === undefined) return 'اجرا نشده';
    const problems =
      (value.different ?? 0) +
      (value.missingGenerated ?? 0) +
      (value.missingReference ?? 0);
    return problems === 0
      ? `${faDigits(value.matched)} مطابق`
      : `${faDigits(problems)} مغایرت`;
  }

  function severityLabel(severity: string): string {
    if (severity === 'error') return 'خطا';
    if (severity === 'warning') return 'هشدار';
    return 'اطلاع';
  }

  function resultSummary(): string {
    if (!result) return 'هنوز خروجی‌ای تولید نشده است';
    if (generation) {
      return `${faDigits(generation.files.length)} فایل در ${formatDuration(generation.durationMs)} تولید شد`;
    }
    return `${result.eventCount.toLocaleString('fa-IR')} رویداد ترِیس اعتبارسنجی شد`;
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
    setBusy(true, 'در حال اعتبارسنجی');
    try {
      const value = await app.rpc?.request.validate(collectInput());
      if (!value) throw new Error('نتیجه‌ای از اعتبارسنجی دریافت نشد.');
      result = value;
      generation = undefined;
      preview = {
        file: 'نتیجه اعتبارسنجی',
        code:
          value.diagnostics.length === 0
            ? 'هیچ مشکل سازگاری یافت نشد.'
            : 'پیش از تولید، موارد عیب‌یابی را بررسی کنید.',
        truncated: false,
      };
      activeFile = '';
      setStatus(
        value.diagnostics.some((item) => item.severity === 'error')
          ? 'اشکال در اعتبارسنجی'
          : 'اعتبارسنجی موفق',
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
    setBusy(true, 'در حال تولید');
    try {
      const value = await app.rpc?.request.generate(collectInput());
      if (!value) throw new Error('نتیجه‌ای از تولید دریافت نشد.');
      result = value;
      generation = value;
      preview = value.preview;
      activeFile = value.preview.file;
      setStatus('تولید کامل شد', 'success');
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function selectGeneratedFile(file: string): Promise<void> {
    if (!generation || busy) return;
    activeFile = file;
    preview = { file, code: 'در حال بارگذاری…', truncated: false };
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
        if (!data) throw new Error('داده‌های راه‌اندازی برنامه دریافت نشد.');
        bootstrapData = data;
        formState.postId = data.posts[0]?.id ?? '';
        if (data.fixtures[0]) setFixture(data.fixtures[0]);
        setStatus('آماده', 'ready');
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
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>
      <div>
        <strong>اچار</strong>
        <span>میزکار پست‌پروسسور</span>
      </div>
    </div>

    <nav class="primary-nav" aria-label="ناوبری اصلی">
      <button class="nav-item active" type="button">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m18 16 4-4-4-4" />
            <path d="m6 8-4 4 4 4" />
            <path d="m14.5 4-5 16" />
          </svg>
        </span>
        تولید جی‌کد
      </button>
      <button class="nav-item" type="button">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" />
            <path d="M6 6h.01" />
            <path d="M6 18h.01" />
          </svg>
        </span>
        سرور MCP
      </button>
    </nav>

    <div class="sidebar-heading">
      <span>نمونه‌ها</span>
      <span class="count">{faDigits(fixtures.length)}</span>
    </div>

    <div class="fixture-list">
      {#each fixtures as fixture}
        <button
          class:active={fixture.root === activeFixtureRoot}
          class="fixture-item"
          type="button"
          onclick={() => setFixture(fixture)}
        >
          <strong dir="ltr">{fixture.programName}</strong>
          <span>
            {fixture.machineProfilePath ? 'همراه با پروفایل ماشین' : fixture.postId}
          </span>
        </button>
      {/each}
    </div>

    <div class="mcp-card">
      <div>
        <strong>سرور MCP</strong>
        <span>اتصال کلاینت‌های هوش مصنوعی از طریق stdio</span>
      </div>
      <code dir="ltr">{mcpCommand}</code>
      <button type="button" onclick={copyMcpCommand}>
        {#if copiedMcp}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          کپی شد!
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          کپی دستور
        {/if}
      </button>
    </div>

    <div class="sidebar-footer">
      <span dir="ltr" title={bootstrapData?.workspaceRoot ?? 'میزکار در دسترس نیست'}>
        {bootstrapData?.workspaceRoot ?? 'میزکار در دسترس نیست'}
      </span>
      <span>اچار نسخه {faDigits('0.1.0')}</span>
    </div>
  </aside>

  <main class="workspace">
    <header class="topbar">
      <div>
        <p class="eyebrow">پست‌پروسسور سی‌ان‌سی</p>
        <h1>تولید برنامه</h1>
      </div>
      <div class="topbar-actions">
        <div class="theme-switch" aria-label="انتخاب پوسته">
          <button
            class:active={theme === 'system'}
            type="button"
            title="سیستم"
            aria-label="پوسته سیستم"
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
            title="روشن"
            aria-label="پوسته روشن"
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
            title="تیره"
            aria-label="پوسته تیره"
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

    <div class="workspace-grid">
      <section class="setup-panel" aria-labelledby="setup-heading">
        <div class="section-heading">
          <div>
            <h2 id="setup-heading">تنظیمات تولید</h2>
            <p>{activeFixtureRoot ? 'نمونه انتخاب شده' : 'ورودی سفارشی'}</p>
          </div>
          <button class="text-button" type="button" onclick={clearFixture}>پاک کردن</button>
        </div>

        <form
          bind:this={formElement}
          onsubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <div class="field full-width">
            <label for="trace-path">فایل ترِیس ۵ <span>الزامی</span></label>
            <div class="path-control">
              <input
                id="trace-path"
                bind:value={formState.tracePath}
                name="tracePath"
                class="ltr-value"
                placeholder="فایل ترِیس MPF را انتخاب کنید"
                required
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('trace')}>انتخاب</button>
            </div>
          </div>

          <div class="field full-width">
            <label for="vmid-path">VMID</label>
            <div class="path-control">
              <input
                id="vmid-path"
                bind:value={formState.vmidPath}
                name="vmidPath"
                class="ltr-value"
                placeholder="تعریف ماشین (اختیاری)"
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('vmid')}>انتخاب</button>
            </div>
          </div>

          <div class="field full-width">
            <label for="profile-path">پروفایل ماشین</label>
            <select
              aria-label="پروفایل‌های ماشین شناخته‌شده"
              class="profile-select"
              value={formState.machineProfilePath}
              onchange={(event) => {
                formState.machineProfilePath = event.currentTarget.value;
              }}
            >
              <option value="">بدون پروفایل ماشین</option>
              {#each machineProfiles as profile}
                <option value={profile.path}>
                  {profile.name ?? profile.id}{profile.axes ? ` / ${faDigits(profile.axes)} محوره` : ''}{profile.controller
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
                placeholder="پروفایل JSON (اختیاری)"
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('profile')}>انتخاب</button>
            </div>
          </div>

          <div class="form-row">
            <div class="field">
              <label for="program-name">نام برنامه <span>الزامی</span></label>
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
              <label for="post-id">پست</label>
              <select id="post-id" bind:value={formState.postId} name="postId">
                {#each posts as post}
                  <option value={post.id}>{post.name}</option>
                {/each}
              </select>
            </div>
          </div>

          <div class="field full-width">
            <label for="reference-path">خروجی مرجع</label>
            <div class="path-control">
              <input
                id="reference-path"
                bind:value={formState.referencePath}
                name="referencePath"
                class="ltr-value"
                placeholder="پوشه مقایسه (اختیاری)"
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('reference')}>انتخاب</button>
            </div>
          </div>

          <div class="field full-width">
            <label for="output-path">پوشه خروجی</label>
            <div class="path-control">
              <input
                id="output-path"
                bind:value={formState.outputPath}
                name="outputPath"
                class="ltr-value"
                placeholder="پیش‌فرض: generated/نام برنامه"
                type="text"
              />
              <button class="browse-button" type="button" onclick={() => choosePath('output')}>انتخاب</button>
            </div>
          </div>

          <div class="form-note">
            پروفایل ماشین اختیاری است؛ در صورت وجود داده‌های پروفایل و VMID، سازگاری
            محورها به‌صورت خودکار بررسی می‌شود.
          </div>

          <div class="form-actions">
            <button class="secondary-button" disabled={busy} type="button" onclick={validate}>اعتبارسنجی</button>
            <button class:loading={busy} class="primary-button" disabled={busy} type="submit">
              <span>تولید جی‌کد</span>
              <span class="button-loader" aria-hidden="true"></span>
            </button>
          </div>
        </form>
      </section>

      <section class="results-panel" aria-labelledby="results-heading">
        <div class="results-header">
          <div>
            <h2 id="results-heading">خروجی</h2>
            <p>{resultSummary()}</p>
          </div>
          <button class="secondary-button compact icon-button" disabled={!generation} type="button" onclick={openOutput}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
            </svg>
            باز کردن پوشه
          </button>
        </div>

        {#if !hasResult}
          <div class="empty-state" in:fade={{ duration: 300 }}>
            <div class="empty-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                <path d="m9 13 2 2 4-4" />
              </svg>
            </div>
            <h3>آماده تولید</h3>
            <p>یک نمونه انتخاب کنید یا فایل ترِیس بدهید؛ سپس اعتبارسنجی یا تولید را اجرا کنید.</p>
          </div>
        {:else}
          <div class="result-content" in:fly={{ y: 14, duration: 350 }}>
            <div class="metrics" aria-label="آمار تولید">
              <div class="metric">
                <span>فایل‌ها</span>
                <strong>{faDigits(generation?.files.length ?? 0)}</strong>
              </div>
              <div class="metric">
                <span>رویدادها</span>
                <strong>{result?.eventCount.toLocaleString('fa-IR') ?? faDigits(0)}</strong>
              </div>
              <div class="metric">
                <span>زمان</span>
                <strong>{result ? formatDuration(result.durationMs) : formatDuration(0)}</strong>
              </div>
              <div class="metric">
                <span>تطابق</span>
                <strong>{parityLabel(generation)}</strong>
              </div>
            </div>

            {#if diagnostics.length > 0}
              <div class="diagnostics-section" in:fade={{ duration: 250 }}>
                <div class="subheading">
                  <h3>عیب‌یابی</h3>
                  <span>{faDigits(diagnostics.length)}</span>
                </div>
                <div class="diagnostics-list">
                  {#each diagnostics as diagnostic}
                    <div class={`diagnostic ${diagnostic.severity}`}>
                      <strong>{severityLabel(diagnostic.severity)}</strong>
                      <span dir="auto">{diagnostic.message}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="output-browser">
              <div class="file-column">
                <div class="subheading">
                  <h3>فایل‌های تولیدشده</h3>
                  <span>{faDigits(generatedFiles.length)}</span>
                </div>
                <div class="file-list">
                  {#each generatedFiles as file}
                    <button
                      class:active={file.file === activeFile}
                      class="file-item"
                      type="button"
                      onclick={() => selectGeneratedFile(file.file)}
                    >
                      <strong dir="ltr">{file.file}</strong>
                      <span>{file.lines.toLocaleString('fa-IR')} خط / {formatBytes(file.bytes)}</span>
                    </button>
                  {/each}
                </div>
              </div>

              <div class="preview-column">
                <div class="preview-toolbar">
                  <span dir="auto">{preview?.file ?? 'پیش‌نمایش'}</span>
                  <span>{preview?.truncated ? 'پیش‌نمایش کوتاه شده' : ''}</span>
                </div>
                <pre dir="ltr" tabindex="0">{preview?.code ?? ''}</pre>
              </div>
            </div>
          </div>
        {/if}

        {#if errorMessage}
          <div class="error-banner" transition:fly={{ y: 8, duration: 250 }}>
            <strong>خطا در اجرا</strong>
            <span dir="auto">{errorMessage}</span>
          </div>
        {/if}
      </section>
    </div>
  </main>
</div>
