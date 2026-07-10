import type {
  AcharBootstrap,
  AcharDiagnostic,
  AcharFixtureSummary,
  AcharGeneratedFile,
  AcharGenerationResult,
  AcharInput,
  AcharMachineProfileSummary,
  AcharValidationResult,
} from '@achar/core';
import type { RPCSchema } from 'electrobun/bun';

export type DesktopFixture = AcharFixtureSummary;
export type DesktopBootstrap = AcharBootstrap;
export type DesktopMachineProfile = AcharMachineProfileSummary;
export type DesktopDiagnostic = AcharDiagnostic;
export type DesktopInput = AcharInput;
export type ValidationResult = AcharValidationResult;
export type DesktopGeneratedFile = AcharGeneratedFile;
export type GenerationResult = AcharGenerationResult;

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
