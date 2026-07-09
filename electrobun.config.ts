import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'Achar',
    identifier: 'tools.achar.desktop',
    version: '0.1.0',
    description: 'Desktop workspace for generating and validating CNC G-code.',
  },
  build: {
    bun: {
      entrypoint: 'src/desktop/bun/index.ts',
      tsconfig: 'tsconfig.json',
    },
    views: {
      mainview: {
        entrypoint: 'src/desktop/mainview/index.ts',
        tsconfig: 'tsconfig.json',
      },
    },
    copy: {
      'src/desktop/mainview/index.html': 'views/mainview/index.html',
      'src/desktop/mainview/index.css': 'views/mainview/index.css',
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
