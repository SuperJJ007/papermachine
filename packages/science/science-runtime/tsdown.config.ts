import { defineConfig } from 'tsdown'

// One multi-entry config, not three independent bundles: the settings-bound
// entry subclasses the root entry, so independent bundling would inline a
// second copy of the whole Runtime and give the two entries separate class
// identities. Named entries keep tsdown's flat `lib/` layout while letting it
// emit the shared Runtime code as one chunk both import.
export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    invariant: 'lib/types/invariant.js',
    'with-settings': 'lib/types/with-settings.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
