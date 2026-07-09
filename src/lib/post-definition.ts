import type { EventsType } from '../types';
import type { EventListener } from './event';
import type { PostContext } from './post-context';
import type { Program } from './program';

export interface PostDefinitionApi<State extends object> {
  readonly context: PostContext<State>;
  on<T extends keyof EventsType>(event: T, listener: EventListener<T>): void;
  onMany<T extends keyof EventsType>(
    events: readonly T[],
    listener: EventListener<T>,
  ): void;
}

export function definePost<State extends object>(
  program: Program,
  context: PostContext<State>,
  configure?: (post: PostDefinitionApi<State>) => void,
): PostDefinitionApi<State> {
  const api: PostDefinitionApi<State> = {
    context,
    on: (event, listener) => program.on(event, listener),
    onMany: (events, listener) => {
      for (const event of events) program.on(event, listener);
    },
  };
  configure?.(api);
  return api;
}
