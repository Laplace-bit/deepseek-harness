import { defineConfig } from 'tsdown'

/** Keep the package root runtime aligned with the Host TypeScript face. */
export default defineConfig(({ env }) => ({
  name: '@deepseek-ai/dsh-typert-protocol',
  entry: env?.DSH_BUILD_FACE === 'client' ? '' : ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}))
