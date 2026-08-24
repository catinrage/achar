import {
  listSiemens828dDialectIds,
  registerSiemens828dPost,
} from '../posts/siemens-828d';
import type { RegisterPost } from './post-loader';

export interface BuiltInPost {
  id: string;
  name: string;
  aliases: string[];
  /**
   * Controller family this post emits for.
   *
   * A machine profile declares the controller its machine has; the two must
   * agree, or a Fanuc machine's settings would be posted through a Siemens
   * post and produce a file no control will accept. Kept separate from `id`
   * because one family can have several posts.
   */
  controller: string;
  /**
   * Output conventions this post can speak, for a machine profile's
   * `dialect` field. Advertised so callers that define machines can reject a
   * bad id while an admin is still looking at the form, rather than at post
   * time. The first entry is the default.
   */
  dialects: string[];
  registerPost: RegisterPost;
}

export const builtinPosts: BuiltInPost[] = [
  {
    id: 'siemens-828d',
    name: 'Siemens 828D Milling 4A',
    aliases: ['default'],
    controller: 'siemens-828d',
    dialects: listSiemens828dDialectIds(),
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
