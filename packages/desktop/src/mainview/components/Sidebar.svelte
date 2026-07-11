<script lang="ts">
  import type { DesktopFixture } from '../../rpc';
  import { faDigits } from '../format';
  import { m } from '../messages/fa';
  import type { ActiveView } from '../types';

  let {
    fixtures,
    activeFixtureRoot,
    activeView,
    mcpCommand,
    copiedMcp,
    workspaceRoot,
    onSelectFixture,
    onNavigate,
    onCopyMcp,
  }: {
    fixtures: DesktopFixture[];
    activeFixtureRoot: string | undefined;
    activeView: ActiveView;
    mcpCommand: string;
    copiedMcp: boolean;
    workspaceRoot: string | undefined;
    onSelectFixture: (fixture: DesktopFixture) => void;
    onNavigate: (view: ActiveView) => void;
    onCopyMcp: () => void;
  } = $props();
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    </div>
    <div>
      <strong>{m.appName}</strong>
      <span>{m.appTagline}</span>
    </div>
  </div>

  <nav class="primary-nav" aria-label={m.navAriaLabel}>
    <button
      class:active={activeView === 'generate'}
      class="nav-item"
      type="button"
      onclick={() => onNavigate('generate')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m18 16 4-4-4-4" />
          <path d="m6 8-4 4 4 4" />
          <path d="m14.5 4-5 16" />
        </svg>
      </span>
      {m.navGenerate}
    </button>
    <button
      class:active={activeView === 'mcp'}
      class="nav-item"
      type="button"
      onclick={() => onNavigate('mcp')}
    >
      <span class="nav-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" />
          <path d="M6 6h.01" />
          <path d="M6 18h.01" />
        </svg>
      </span>
      {m.navMcp}
    </button>
  </nav>

  <div class="sidebar-heading">
    <span>{m.fixturesHeading}</span>
    <span class="count">{faDigits(fixtures.length)}</span>
  </div>

  <div class="fixture-list">
    {#each fixtures as fixture}
      <button
        class:active={fixture.root === activeFixtureRoot}
        class="fixture-item"
        type="button"
        onclick={() => onSelectFixture(fixture)}
      >
        <strong dir="ltr">{fixture.programName}</strong>
        <span>
          {fixture.machineProfilePath ? m.fixtureHasProfile : fixture.postId}
        </span>
      </button>
    {/each}
  </div>

  <div class="mcp-card">
    <div>
      <strong>{m.mcpCardTitle}</strong>
      <span>{m.mcpCardSubtitle}</span>
    </div>
    <code dir="ltr">{mcpCommand}</code>
    <button type="button" onclick={onCopyMcp}>
      {#if copiedMcp}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {m.mcpCopied}
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {m.mcpCopy}
      {/if}
    </button>
  </div>

  <div class="sidebar-footer">
    <span dir="ltr" title={workspaceRoot ?? m.workspaceUnavailable}>
      {workspaceRoot ?? m.workspaceUnavailable}
    </span>
    <span>{m.appVersion} {faDigits('0.1.0')}</span>
  </div>
</aside>
