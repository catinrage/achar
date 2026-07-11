<script lang="ts">
  import { fade } from 'svelte/transition';
  import { m } from '../messages/fa';

  let {
    mcpCommand,
    environment,
    copiedMcp,
    onCopyMcp,
  }: {
    mcpCommand: string;
    environment: Record<string, string>;
    copiedMcp: boolean;
    onCopyMcp: () => void;
  } = $props();

  const environmentEntries = $derived(Object.entries(environment));
</script>

<section class="mcp-panel" aria-labelledby="mcp-heading" in:fade={{ duration: 250 }}>
  <div class="section-heading">
    <div>
      <h2 id="mcp-heading">{m.mcpPanelTitle}</h2>
      <p>{m.mcpPanelBody}</p>
    </div>
  </div>

  <div class="mcp-command-block">
    <span class="mcp-command-label">{m.mcpPanelCommandLabel}</span>
    <code dir="ltr">{mcpCommand}</code>
    <button class="primary-button compact" type="button" onclick={onCopyMcp}>
      {copiedMcp ? m.mcpCopied : m.mcpCopy}
    </button>
  </div>

  {#if environmentEntries.length > 0}
    <div class="mcp-env">
      {#each environmentEntries as [key, value]}
        <code dir="ltr">{key}={value}</code>
      {/each}
    </div>
  {/if}

  <div class="subheading">
    <h3>{m.mcpPanelToolsHeading}</h3>
  </div>
  <div class="mcp-tools">
    {#each m.mcpTools as tool}
      <div class="mcp-tool">
        <code dir="ltr">{tool.name}</code>
        <span>{tool.description}</span>
      </div>
    {/each}
  </div>

  <p class="form-note">{m.mcpPanelEnvNote}</p>
</section>
