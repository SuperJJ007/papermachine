import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['lib/types/main.js', 'lib/types/watchdog.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    // Sandboxed Electron preloads run as CommonJS even though the application package is ESM.
    entry: {
      preload: 'lib/types/preload.js',
      'preload-app': 'lib/types/preload-app.js',
      'preload-onboarding': 'lib/types/preload-onboarding.js',
      'preload-recovery': 'lib/types/preload-recovery.js',
    },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
])
