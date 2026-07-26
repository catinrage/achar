import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { AcharInput } from '@achar/core';

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function nearestExistingAncestor(target: string): string {
  let current = target;

  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }

  return current;
}

/**
 * Resolves a model-supplied path and rejects lexical traversal as well as
 * symlink ancestors that escape the MCP workspace.
 */
export function resolveInsideWorkspace(
  workspaceRoot: string,
  target: string,
  label: string,
): string {
  const lexicalRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(lexicalRoot, target);
  if (!isInside(lexicalRoot, resolved)) {
    throw new Error(
      `${label} must stay inside the workspace root (${lexicalRoot}); received: ${target}`,
    );
  }

  const realRoot = realpathSync(lexicalRoot);
  const ancestor = nearestExistingAncestor(resolved);
  const realAncestor = realpathSync(ancestor);
  if (!isInside(realRoot, realAncestor)) {
    throw new Error(
      `${label} must not traverse a symlink outside the workspace root (${lexicalRoot}); received: ${target}`,
    );
  }

  return path.resolve(realAncestor, path.relative(ancestor, resolved));
}

export function constrainAcharInput(
  workspaceRoot: string,
  input: AcharInput,
): AcharInput {
  const inside = (target: string | undefined, label: string) =>
    target ? resolveInsideWorkspace(workspaceRoot, target, label) : undefined;

  return {
    ...input,
    tracePath: resolveInsideWorkspace(
      workspaceRoot,
      input.tracePath,
      'tracePath',
    ),
    vmidPath: inside(input.vmidPath, 'vmidPath'),
    machineProfilePath: inside(input.machineProfilePath, 'machineProfilePath'),
    referencePath: inside(input.referencePath, 'referencePath'),
    outputPath: inside(input.outputPath, 'outputPath'),
  };
}
