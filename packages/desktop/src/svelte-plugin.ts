import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { BunPlugin } from 'bun';
import { compile } from 'svelte/compiler';

const desktopRoot = path.resolve(import.meta.dir, '..');
const svelteRoot = realpathSync(
  path.join(desktopRoot, 'node_modules', 'svelte'),
);

const packageImports: Record<string, string> = {
  '#client/constants': path.join(
    svelteRoot,
    'src',
    'internal',
    'client',
    'constants.js',
  ),
};

function resolveSvelteRuntime(specifier: string): string | undefined {
  const subpath = specifier.replace(/^svelte\/?/, '');
  if (!subpath) return path.join(svelteRoot, 'src', 'index-client.js');

  const known: Record<string, string> = {
    events: 'src/events/index.js',
    'internal/client': 'src/internal/client/index.js',
    'internal/disclose-version': 'src/internal/disclose-version.js',
    'internal/flags/async': 'src/internal/flags/async.js',
    'internal/flags/legacy': 'src/internal/flags/legacy.js',
    'internal/flags/tracing': 'src/internal/flags/tracing.js',
  };
  return known[subpath] ? path.join(svelteRoot, known[subpath]) : undefined;
}

export function sveltePlugin(): BunPlugin {
  return {
    name: 'achar-svelte',
    setup(builder) {
      builder.onResolve({ filter: /^svelte(\/.*)?$/ }, (args) => {
        const resolved = resolveSvelteRuntime(args.path);
        return resolved ? { path: resolved } : undefined;
      });

      builder.onResolve({ filter: /^#client\/constants$/ }, (args) => ({
        path: packageImports[args.path],
      }));

      builder.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const source = await Bun.file(args.path).text();
        const result = compile(source, {
          filename: args.path,
          generate: 'client',
          dev: process.env.NODE_ENV !== 'production',
          css: 'injected',
          name: path.basename(args.path, '.svelte'),
        });

        return {
          contents: result.js.code,
          loader: 'js',
        };
      });
    },
  };
}
