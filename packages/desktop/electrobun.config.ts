import type { ElectrobunConfig } from 'electrobun';
import { sveltePlugin } from './src/svelte-plugin';

const svelte = sveltePlugin();

export default {
  app: {
    name: 'Achar',
    identifier: 'tools.achar.desktop',
    version: '0.1.0',
    description: 'Desktop workspace for generating and validating CNC G-code.',
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
      tsconfig: 'tsconfig.json',
    },
    views: {
      mainview: {
        entrypoint: 'src/mainview/index.ts',
        tsconfig: 'tsconfig.json',
        plugins: [svelte],
      },
    },
    copy: {
      'src/mainview/index.html': 'views/mainview/index.html',
      'src/mainview/index.css': 'views/mainview/index.css',
      'node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2':
        'views/mainview/fonts/Vazirmatn-Variable.woff2',
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: {
      // Windows 11 includes the WebView2 runtime, so avoid shipping a second browser.
      bundleCEF: false,
      defaultRenderer: 'native',
    },
  },
} satisfies ElectrobunConfig;
