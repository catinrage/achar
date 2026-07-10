import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.error(
    'Windows desktop releases must be built on Windows. Run this command on a Windows x64 host or CI runner.',
  );
  process.exit(1);
}

const build = Bun.spawn(['bun', 'x', 'electrobun', 'build', '--env=stable'], {
  cwd: fileURLToPath(new URL('../packages/desktop/', import.meta.url)),
  env: process.env,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exit(await build.exited);
