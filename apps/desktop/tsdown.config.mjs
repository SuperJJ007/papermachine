import { defineConfig } from 'tsdown'

/**
 * Bundle the Electron main process and its plain-Node watchdog from typed
 * output as ESM. The preload builds separately as CommonJS: Electron
 * requires a `.mjs` extension for an ESM preload, and a sandboxed renderer
 * (`sandbox: true`, set on every BrowserWindow this app creates) does not
 * support ESM preloads at all regardless of extension.
 */
export default defineConfig([
  {
    entry: [
      'lib/types/src/main.js',
      'lib/types/src/watchdog.js',
      'lib/types/src/onboarding.js',
      'lib/types/src/environment-declaration.js',
      'lib/types/src/provisioning.js',
      'lib/types/src/runtime-overlay.js',
    ],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    deps: { neverBundle: ['electron'] },
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/src/preload.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    deps: { neverBundle: ['electron'] },
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
