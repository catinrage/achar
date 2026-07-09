import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBuiltinPost } from './builtin-posts';
import type { MachineProfile } from './machine-profile';
import type { Program } from './program';

export interface PostRuntimeContext {
  machineProfile?: MachineProfile;
}

export type RegisterPost = (
  program: Program,
  context?: PostRuntimeContext,
) => void;

export interface PostModule {
  registerPost?: RegisterPost;
  registerDefaultPost?: RegisterPost;
  default?: RegisterPost | { registerPost?: RegisterPost };
}

export async function loadPost(post?: string): Promise<RegisterPost> {
  const postId = post ?? 'default';
  const builtInPost = resolveBuiltinPost(postId);
  if (builtInPost) {
    return builtInPost.registerPost;
  }

  const modulePath = postId.startsWith('file:')
    ? postId
    : pathToFileURL(path.resolve(postId)).href;
  const loaded = (await import(modulePath)) as PostModule;

  if (typeof loaded.default === 'function') {
    return loaded.default;
  }

  if (
    typeof loaded.default === 'object' &&
    typeof loaded.default?.registerPost === 'function'
  ) {
    return loaded.default.registerPost;
  }

  if (typeof loaded.registerPost === 'function') {
    return loaded.registerPost;
  }

  if (typeof loaded.registerDefaultPost === 'function') {
    return loaded.registerDefaultPost;
  }

  throw new Error(
    `Post module ${postId} must export registerPost(program), registerDefaultPost(program), or a default register function.`,
  );
}
