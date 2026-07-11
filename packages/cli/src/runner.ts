/** Wraps a command action so its numeric return value becomes the exit code. */
export function runCommand<Args extends unknown[]>(
  handler: (...args: Args) => Promise<number> | number,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    const code = await handler(...args);
    process.exitCode = typeof code === 'number' ? code : 0;
  };
}
