import { rm } from 'node:fs/promises';
import path from 'node:path';
import { sveltePlugin } from './svelte-plugin';

/**
 * Builds the workshop UI into `dist/`, which the server serves as static
 * assets. There is no dev server: the API and the page come from the same
 * origin in production, and a second origin in development would only invite
 * CORS problems that do not exist in the deployment.
 *
 * Pass `--watch` to rebuild on change while `achar serve` is running.
 */

const root = path.resolve(import.meta.dir);
const source = path.join(root, 'src');
const outdir = path.join(root, 'dist');

async function build(): Promise<void> {
  await rm(outdir, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [path.join(source, 'index.ts')],
    outdir,
    target: 'browser',
    minify: process.env.NODE_ENV === 'production',
    sourcemap: 'linked',
    plugins: [sveltePlugin()],
  });

  if (!result.success) {
    for (const message of result.logs) console.error(message);
    throw new Error('The web build failed.');
  }

  await Bun.write(
    path.join(outdir, 'index.html'),
    await Bun.file(path.join(source, 'index.html')).text(),
  );
  await Bun.write(
    path.join(outdir, 'index.css'),
    await Bun.file(path.join(source, 'index.css')).text(),
  );
  await Bun.write(
    path.join(outdir, 'fonts', 'Vazirmatn-Variable.woff2'),
    Bun.file(
      path.join(
        root,
        'node_modules',
        'vazirmatn',
        'fonts',
        'webfonts',
        'Vazirmatn[wght].woff2',
      ),
    ),
  );

  const bytes = result.outputs.reduce((total, file) => total + file.size, 0);
  console.log(
    `[achar:web] built ${result.outputs.length} file(s), ${(bytes / 1024).toFixed(0)} KB`,
  );
}

await build();

if (process.argv.includes('--watch')) {
  const { watch } = await import('node:fs');
  let pending: ReturnType<typeof setTimeout> | undefined;
  watch(source, { recursive: true }, () => {
    // Editors write several times per save; one rebuild per burst is enough.
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      void build().catch((error) => console.error(error));
    }, 60);
  });
  console.log('[achar:web] watching src/ for changes');
}
