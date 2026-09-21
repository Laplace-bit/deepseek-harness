import { defineConfig } from 'tsdown'

/** Single browser asset served by the Vue host at /ai-harness/assistant.js. */
export default defineConfig({
  entry: ['src/global.ts'],
  outDir: 'lib',
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  // The shared Cordis loader contains a Node-only internal-module probe. Keep
  // its browser branch inert so the embedded bundle never evaluates `process`
  // or `node:module` in a Vue page.
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.versions.node': '"0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
  resolve: {
    alias: {
      'node:module': './src/node-module-shim.ts',
    },
  },
  dts: false,
  noExternal: [/.*/],
  outputOptions: { inlineDynamicImports: true, entryFileNames: 'assistant.js' },
})
