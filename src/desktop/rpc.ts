import type { RPCSchema } from 'electrobun/bun';

export interface DesktopFixture {
  name: string;
  root: string;
  tracePath: string;
  referencePath: string;
  outputPath?: string;
  programName: string;
  postId: string;
  vmidPath?: string;
  machineProfilePath?: string;
}

export interface DesktopBootstrap {
  workspaceRoot: string;
  fixturesRoot?: string;
  fixtures: DesktopFixture[];
  posts: Array<{ id: string; name: string }>;
}

export interface DesktopDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  event?: string;
  key?: string;
}

export interface DesktopInput {
  tracePath: string;
  vmidPath?: string;
  machineProfilePath?: string;
  referencePath?: string;
  outputPath?: string;
  programName: string;
  postId: string;
}

export interface ValidationResult {
  eventCount: number;
  durationMs: number;
  diagnostics: DesktopDiagnostic[];
}

export interface DesktopGeneratedFile {
  file: string;
  bytes: number;
  lines: number;
}

export interface GenerationResult extends ValidationResult {
  outputPath: string;
  files: DesktopGeneratedFile[];
  matched?: number;
  different?: number;
  missingGenerated?: number;
  missingReference?: number;
  preview: {
    file: string;
    code: string;
    truncated: boolean;
  };
}

export type PathKind = 'trace' | 'vmid' | 'profile' | 'reference' | 'output';

export type AcharDesktopRPC = {
  bun: RPCSchema<{
    requests: {
      bootstrap: {
        params: Record<never, never>;
        response: DesktopBootstrap;
      };
      choosePath: {
        params: { kind: PathKind; startingFolder?: string };
        response: string | null;
      };
      validate: { params: DesktopInput; response: ValidationResult };
      generate: { params: DesktopInput; response: GenerationResult };
      readOutputFile: {
        params: { outputPath: string; file: string };
        response: GenerationResult['preview'];
      };
      openPath: { params: { path: string }; response: boolean };
    };
    messages: Record<never, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<never, never>;
    messages: Record<never, never>;
  }>;
};
