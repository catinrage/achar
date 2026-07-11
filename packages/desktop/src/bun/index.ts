import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  bootstrapAchar,
  generateAcharFiles,
  readGeneratedFile,
  resolveWorkspaceRoot,
  validateAcharInput,
} from '@achar/core';
import { BrowserView, BrowserWindow, Utils } from 'electrobun/bun';
import type { AcharDesktopRPC, PathKind } from '../rpc';

const workspaceRoot = resolveWorkspaceRoot();

function firstDialogPath(paths: string[]): string | null {
  const selected = paths.find((item) => item.trim().length > 0);
  return selected ? path.resolve(selected) : null;
}

async function choosePath(
  kind: PathKind,
  startingFolder?: string,
): Promise<string | null> {
  const chooseDirectory = kind === 'output' || kind === 'reference';
  const paths = await Utils.openFileDialog({
    startingFolder:
      startingFolder && existsSync(startingFolder)
        ? startingFolder
        : workspaceRoot,
    allowedFileTypes: '*',
    canChooseFiles: !chooseDirectory,
    canChooseDirectory: chooseDirectory,
    allowsMultipleSelection: false,
  });
  return firstDialogPath(paths);
}

const rpc = BrowserView.defineRPC<AcharDesktopRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {
      bootstrap: () => bootstrapAchar(workspaceRoot),
      choosePath: ({ kind, startingFolder }) =>
        choosePath(kind, startingFolder),
      validate: (input) => validateAcharInput(input),
      generate: (input) => generateAcharFiles(input, workspaceRoot),
      readOutputFile: ({ outputPath, file }) =>
        readGeneratedFile(outputPath, file),
      openPath: ({ path: target }) => {
        const resolved = path.resolve(target);
        if (!existsSync(resolved)) return false;
        return Utils.openPath(resolved);
      },
    },
    messages: {},
  },
});

new BrowserWindow({
  title: 'اچار',
  url: 'views://mainview/index.html',
  rpc,
  frame: {
    width: 1320,
    height: 820,
    x: 80,
    y: 40,
  },
});
