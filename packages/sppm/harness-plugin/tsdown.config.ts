import { defineConfig } from 'tsdown'

/** Bundle the Cordis plugin entry from its TypeScript build output. */
export default defineConfig(({ env }) => ({
  entry: env?.DSH_BUILD_FACE === 'client' ? '' : ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}))
