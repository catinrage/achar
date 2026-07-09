export type ContextFactory<T> = () => T;

export class PostContext<T extends object> {
  private value: T;

  public constructor(private readonly factory: ContextFactory<T>) {
    this.value = factory();
  }

  public get state(): T {
    return this.value;
  }

  public patch(values: Partial<T>): T {
    Object.assign(this.value, values);
    return this.value;
  }

  public reset(): T {
    this.value = this.factory();
    return this.value;
  }
}

export function createPostContext<T extends object>(
  factory: ContextFactory<T>,
): PostContext<T> {
  return new PostContext(factory);
}
