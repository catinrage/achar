import { registerSiemens828dPost } from '../posts/siemens-828d';
import type { RegisterPost } from './post-loader';

export interface BuiltInPost {
  id: string;
  name: string;
  aliases: string[];
  registerPost: RegisterPost;
}

export const builtinPosts: BuiltInPost[] = [
  {
    id: 'siemens-828d',
    name: 'Siemens 828D Milling 4A',
    aliases: ['default'],
    registerPost: (program, context) =>
      registerSiemens828dPost(program, {
        machineProfile: context?.machineProfile,
      }),
  },
];

export function listBuiltinPosts(): BuiltInPost[] {
  return [...builtinPosts];
}

export function resolveBuiltinPost(post: string): BuiltInPost | undefined {
  return builtinPosts.find(
    (builtInPost) =>
      builtInPost.id === post || builtInPost.aliases.includes(post),
  );
}
