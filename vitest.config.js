import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@achar/core': path.join(root, 'packages/core/src/index.ts'),
      '@achar/mcp': path.join(root, 'packages/mcp/src/server.ts'),
    },
  },
  test: {
    include: ['packages/**/*.spec.ts', 'test/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/artifacts/**',
      '**/generated/**',
    ],
  },
});
