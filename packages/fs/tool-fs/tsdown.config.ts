import { defineConfig } from 'tsdown'

// The read-only entry ships as its own bundled entry alongside the root
// plugin and invariant companion, matching their flat `lib/` layout instead
// of the default workspace glob (which only bundles index/invariant/startup).
export default defineConfig({
  entry: { index: 'lib/types/index.js', invariant: 'lib/types/invariant.js', 'read-only': 'lib/types/read-only.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
