import { Electroview } from 'electrobun/view';
import type {
  AcharDesktopRPC,
  DesktopBootstrap,
  DesktopDiagnostic,
  DesktopFixture,
  DesktopInput,
  GenerationResult,
  PathKind,
  ValidationResult,
} from '../rpc';

const rpc = Electroview.defineRPC<AcharDesktopRPC>({
  maxRequestTime: 120_000,
  handlers: { requests: {}, messages: {} },
});
const app = new Electroview({ rpc });

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing desktop element: ${id}`);
  return found as T;
}

const form = element<HTMLFormElement>('generate-form');
const fixtureList = element<HTMLDivElement>('fixture-list');
const fixtureCount = element<HTMLSpanElement>('fixture-count');
const fixtureLabel = element<HTMLParagraphElement>('fixture-label');
const workspacePath = element<HTMLSpanElement>('workspace-path');
const connectionStatus = element<HTMLDivElement>('connection-status');
const clearFixtureButton = element<HTMLButtonElement>('clear-fixture');
const validateButton = element<HTMLButtonElement>('validate-button');
const generateButton = element<HTMLButtonElement>('generate-button');
const openOutputButton = element<HTMLButtonElement>('open-output');
const emptyState = element<HTMLDivElement>('empty-state');
const resultContent = element<HTMLDivElement>('result-content');
const resultSummary = element<HTMLParagraphElement>('result-summary');
const errorBanner = element<HTMLDivElement>('error-banner');
const errorMessage = element<HTMLSpanElement>('error-message');
const diagnosticsSection = element<HTMLDivElement>('diagnostics-section');
const diagnosticsList = element<HTMLDivElement>('diagnostics-list');
const diagnosticCount = element<HTMLSpanElement>('diagnostic-count');
const fileList = element<HTMLDivElement>('file-list');
const fileCount = element<HTMLSpanElement>('file-count');
const previewFilename = element<HTMLSpanElement>('preview-filename');
const previewNote = element<HTMLSpanElement>('preview-note');
const codePreview = element<HTMLPreElement>('code-preview');
const postSelect = element<HTMLSelectElement>('post-id');

const inputs = {
  tracePath: element<HTMLInputElement>('trace-path'),
  vmidPath: element<HTMLInputElement>('vmid-path'),
  machineProfilePath: element<HTMLInputElement>('profile-path'),
  programName: element<HTMLInputElement>('program-name'),
  referencePath: element<HTMLInputElement>('reference-path'),
  outputPath: element<HTMLInputElement>('output-path'),
};

let bootstrapData: DesktopBootstrap | undefined;
let activeFixtureRoot: string | undefined;
let generation: GenerationResult | undefined;
let busy = false;

function setStatus(
  label: string,
  state: 'neutral' | 'ready' | 'busy' | 'success' | 'error',
): void {
  connectionStatus.textContent = label;
  connectionStatus.className = `status-pill ${state}`;
}

function setBusy(value: boolean, label = 'Working'): void {
  busy = value;
  validateButton.disabled = value;
  generateButton.disabled = value;
  generateButton.classList.toggle('loading', value);
  if (value) setStatus(label, 'busy');
}

function setError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  errorMessage.textContent = message;
  errorBanner.hidden = false;
  setStatus('Action failed', 'error');
}

function clearError(): void {
  errorBanner.hidden = true;
  errorMessage.textContent = '';
}

function collectInput(): DesktopInput {
  return {
    tracePath: inputs.tracePath.value.trim(),
    vmidPath: inputs.vmidPath.value.trim() || undefined,
    machineProfilePath: inputs.machineProfilePath.value.trim() || undefined,
    programName: inputs.programName.value.trim(),
    referencePath: inputs.referencePath.value.trim() || undefined,
    outputPath: inputs.outputPath.value.trim() || undefined,
    postId: postSelect.value,
  };
}

function setFixture(fixture: DesktopFixture): void {
  activeFixtureRoot = fixture.root;
  fixtureLabel.textContent = fixture.name;
  inputs.tracePath.value = fixture.tracePath;
  inputs.vmidPath.value = fixture.vmidPath ?? '';
  inputs.machineProfilePath.value = fixture.machineProfilePath ?? '';
  inputs.programName.value = fixture.programName;
  inputs.referencePath.value = fixture.referencePath;
  inputs.outputPath.value = fixture.outputPath ?? '';
  postSelect.value = fixture.postId;
  renderFixtureSelection();
  clearError();
}

function clearFixture(): void {
  activeFixtureRoot = undefined;
  fixtureLabel.textContent = 'Custom inputs';
  form.reset();
  if (postSelect.options.length > 0) postSelect.selectedIndex = 0;
  renderFixtureSelection();
  clearError();
}

function renderFixtureSelection(): void {
  fixtureList.querySelectorAll('.fixture-item').forEach((item) => {
    item.classList.toggle(
      'active',
      (item as HTMLElement).dataset.root === activeFixtureRoot,
    );
  });
}

function renderFixtures(fixtures: DesktopFixture[]): void {
  fixtureList.replaceChildren();
  fixtureCount.textContent = String(fixtures.length);

  for (const fixture of fixtures) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fixture-item';
    button.dataset.root = fixture.root;

    const name = document.createElement('strong');
    name.textContent = fixture.programName;
    const detail = document.createElement('span');
    detail.textContent = fixture.machineProfilePath
      ? 'Machine profile attached'
      : fixture.postId;
    button.append(name, detail);
    button.addEventListener('click', () => setFixture(fixture));
    fixtureList.append(button);
  }
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

function renderDiagnostics(diagnostics: DesktopDiagnostic[]): void {
  diagnosticsList.replaceChildren();
  diagnosticsSection.hidden = diagnostics.length === 0;
  diagnosticCount.textContent = String(diagnostics.length);

  for (const diagnostic of diagnostics) {
    const row = document.createElement('div');
    row.className = `diagnostic ${diagnostic.severity}`;
    const severity = document.createElement('strong');
    severity.textContent = diagnostic.severity;
    const message = document.createElement('span');
    message.textContent = diagnostic.message;
    row.append(severity, message);
    diagnosticsList.append(row);
  }
}

function parityLabel(result: GenerationResult): string {
  if (result.matched === undefined) return 'Not run';
  const problems =
    (result.different ?? 0) +
    (result.missingGenerated ?? 0) +
    (result.missingReference ?? 0);
  return problems === 0 ? `${result.matched} matched` : `${problems} issues`;
}

function showResultShell(result: ValidationResult, fileTotal: number): void {
  emptyState.hidden = true;
  resultContent.hidden = false;
  element<HTMLElement>('metric-files').textContent = String(fileTotal);
  element<HTMLElement>('metric-events').textContent =
    result.eventCount.toLocaleString();
  element<HTMLElement>('metric-duration').textContent = formatDuration(
    result.durationMs,
  );
  renderDiagnostics(result.diagnostics);
}

function setPreview(preview: GenerationResult['preview']): void {
  previewFilename.textContent = preview.file;
  previewNote.textContent = preview.truncated ? 'Preview truncated' : '';
  codePreview.textContent = preview.code;
  codePreview.scrollTop = 0;
  codePreview.scrollLeft = 0;
}

function renderFiles(result: GenerationResult): void {
  fileList.replaceChildren();
  fileCount.textContent = String(result.files.length);

  for (const [index, file] of result.files.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `file-item${file.file === result.preview.file ? ' active' : ''}`;
    const name = document.createElement('strong');
    name.textContent = file.file;
    const detail = document.createElement('span');
    detail.textContent = `${file.lines.toLocaleString()} lines / ${formatBytes(file.bytes)}`;
    button.append(name, detail);
    button.addEventListener('click', async () => {
      if (!generation || busy) return;
      fileList.querySelectorAll('.file-item').forEach((item) => {
        item.classList.remove('active');
      });
      button.classList.add('active');
      previewFilename.textContent = file.file;
      previewNote.textContent = 'Loading';
      try {
        const output = await app.rpc?.request.readOutputFile({
          outputPath: generation.outputPath,
          file: file.file,
        });
        if (output) setPreview(output);
      } catch (error) {
        setError(error);
      }
    });
    button.style.order = String(index);
    fileList.append(button);
  }
}

function renderGeneration(result: GenerationResult): void {
  generation = result;
  showResultShell(result, result.files.length);
  resultSummary.textContent = `Generated ${result.files.length} files in ${formatDuration(result.durationMs)}`;
  element<HTMLElement>('metric-parity').textContent = parityLabel(result);
  renderFiles(result);
  setPreview(result.preview);
  openOutputButton.disabled = false;
}

async function validate(): Promise<void> {
  if (busy || !form.reportValidity()) return;
  clearError();
  setBusy(true, 'Validating');
  try {
    const result = await app.rpc?.request.validate(collectInput());
    if (!result) throw new Error('No validation result was returned.');
    showResultShell(result, 0);
    resultSummary.textContent = `Validated ${result.eventCount.toLocaleString()} trace events`;
    element<HTMLElement>('metric-parity').textContent = 'Not run';
    fileList.replaceChildren();
    fileCount.textContent = '0';
    previewFilename.textContent = 'Validation complete';
    previewNote.textContent = '';
    codePreview.textContent =
      result.diagnostics.length === 0
        ? 'No compatibility issues found.'
        : 'Review the diagnostics above before generation.';
    openOutputButton.disabled = true;
    setStatus(
      result.diagnostics.some((item) => item.severity === 'error')
        ? 'Validation issues'
        : 'Validation passed',
      result.diagnostics.some((item) => item.severity === 'error')
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
  if (busy || !form.reportValidity()) return;
  clearError();
  setBusy(true, 'Generating');
  try {
    const result = await app.rpc?.request.generate(collectInput());
    if (!result) throw new Error('No generation result was returned.');
    renderGeneration(result);
    setStatus('Generation complete', 'success');
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
  }
}

const pathInputByKind: Record<PathKind, HTMLInputElement> = {
  trace: inputs.tracePath,
  vmid: inputs.vmidPath,
  profile: inputs.machineProfilePath,
  reference: inputs.referencePath,
  output: inputs.outputPath,
};

document
  .querySelectorAll<HTMLButtonElement>('[data-path-kind]')
  .forEach((button) => {
    button.addEventListener('click', async () => {
      if (busy) return;
      const kind = button.dataset.pathKind as PathKind;
      try {
        const selected = await app.rpc?.request.choosePath({
          kind,
          startingFolder: bootstrapData?.workspaceRoot,
        });
        if (selected) pathInputByKind[kind].value = selected;
      } catch (error) {
        setError(error);
      }
    });
  });

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void generate();
});
validateButton.addEventListener('click', () => void validate());
clearFixtureButton.addEventListener('click', clearFixture);
openOutputButton.addEventListener('click', () => {
  if (generation)
    void app.rpc?.request.openPath({ path: generation.outputPath });
});

async function initialize(): Promise<void> {
  try {
    const data = await app.rpc?.request.bootstrap({});
    if (!data) throw new Error('Desktop bootstrap returned no data.');
    bootstrapData = data;
    workspacePath.textContent = data.workspaceRoot;
    workspacePath.title = data.workspaceRoot;

    postSelect.replaceChildren();
    for (const post of data.posts) {
      const option = document.createElement('option');
      option.value = post.id;
      option.textContent = post.name;
      postSelect.append(option);
    }
    renderFixtures(data.fixtures);
    if (data.fixtures[0]) setFixture(data.fixtures[0]);
    setStatus('Ready', 'ready');
  } catch (error) {
    setError(error);
  }
}

void initialize();
