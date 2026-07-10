export type PostPolicy<T extends object> = Readonly<T>;

export function definePostPolicy<T extends object>(policy: T): PostPolicy<T> {
  return Object.freeze(policy);
}

export function extendPostPolicy<T extends object, U extends object>(
  base: PostPolicy<T>,
  overrides: U,
): PostPolicy<T & U> {
  return definePostPolicy({ ...base, ...overrides });
}
