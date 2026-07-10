import type { Builder } from './builder';

export interface BuilderDriver<Api extends object = object> {
  id: string;
  capabilities?: readonly string[];
  create(builder: Builder): Api;
}

export function defineDriver<Api extends object>(
  driver: BuilderDriver<Api>,
): BuilderDriver<Api> {
  return driver;
}
