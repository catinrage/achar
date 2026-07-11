<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import type { GenerationResult, ValidationResult } from '../../rpc';
  import {
    faDigits,
    formatBytes,
    formatDuration,
    parityLabel,
    severityLabel,
  } from '../format';
  import { m } from '../messages/fa';

  let {
    result,
    generation,
    preview,
    activeFile,
    errorMessage,
    onSelectFile,
    onOpenOutput,
  }: {
    result: ValidationResult | GenerationResult | undefined;
    generation: GenerationResult | undefined;
    preview: GenerationResult['preview'] | undefined;
    activeFile: string;
    errorMessage: string;
    onSelectFile: (file: string) => void;
    onOpenOutput: () => void;
  } = $props();

  const generatedFiles = $derived(generation?.files ?? []);
  const diagnostics = $derived(result?.diagnostics ?? []);
  const hasResult = $derived(Boolean(result));

  function resultSummary(): string {
    if (!result) return m.noRunYet;
    if (generation) {
      return m.generatedSummary(
        faDigits(generation.files.length),
        formatDuration(generation.durationMs),
      );
    }
    return m.validatedSummary(result.eventCount.toLocaleString('fa-IR'));
  }
</script>

<section class="results-panel" aria-labelledby="results-heading">
  <div class="results-header">
    <div>
      <h2 id="results-heading">{m.resultsHeading}</h2>
      <p>{resultSummary()}</p>
    </div>
    <button class="secondary-button compact icon-button" disabled={!generation} type="button" onclick={onOpenOutput}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      </svg>
      {m.openFolder}
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
      <h3>{m.emptyTitle}</h3>
      <p>{m.emptyBody}</p>
    </div>
  {:else}
    <div class="result-content" in:fly={{ y: 14, duration: 350 }}>
      <div class="metrics" aria-label={m.metricsAriaLabel}>
        <div class="metric">
          <span>{m.metricFiles}</span>
          <strong>{faDigits(generation?.files.length ?? 0)}</strong>
        </div>
        <div class="metric">
          <span>{m.metricEvents}</span>
          <strong>{result?.eventCount.toLocaleString('fa-IR') ?? faDigits(0)}</strong>
        </div>
        <div class="metric">
          <span>{m.metricElapsed}</span>
          <strong>{result ? formatDuration(result.durationMs) : formatDuration(0)}</strong>
        </div>
        <div class="metric">
          <span>{m.metricParity}</span>
          <strong>{parityLabel(generation)}</strong>
        </div>
      </div>

      {#if diagnostics.length > 0}
        <div class="diagnostics-section" in:fade={{ duration: 250 }}>
          <div class="subheading">
            <h3>{m.diagnosticsHeading}</h3>
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
            <h3>{m.generatedFilesHeading}</h3>
            <span>{faDigits(generatedFiles.length)}</span>
          </div>
          <div class="file-list">
            {#each generatedFiles as file}
              <button
                class:active={file.file === activeFile}
                class="file-item"
                type="button"
                onclick={() => onSelectFile(file.file)}
              >
                <strong dir="ltr">{file.file}</strong>
                <span>{file.lines.toLocaleString('fa-IR')} {m.lines} / {formatBytes(file.bytes)}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="preview-column">
          <div class="preview-toolbar">
            <span dir="auto">{preview?.file ?? m.preview}</span>
            <span>{preview?.truncated ? m.previewTruncated : ''}</span>
          </div>
          <pre dir="ltr" tabindex="0">{preview?.code ?? ''}</pre>
        </div>
      </div>
    </div>
  {/if}

  {#if errorMessage}
    <div class="error-banner" transition:fly={{ y: 8, duration: 250 }}>
      <strong>{m.errorBannerTitle}</strong>
      <span dir="auto">{errorMessage}</span>
    </div>
  {/if}
</section>
