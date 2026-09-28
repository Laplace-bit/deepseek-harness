import { defineConfig } from 'tsdown'

/** Build the package API for Host and the standalone asset for the Client. */
export default defineConfig(({ env }) => {
  if (env?.DSH_BUILD_FACE !== 'client') {
    return {
      entry: ['lib/types/index.js'],
      outDir: 'lib',
      format: ['esm'],
      platform: 'browser',
      target: 'es2022',
      dts: false,
      clean: false,
    }
  }

  return {
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
  }
})
