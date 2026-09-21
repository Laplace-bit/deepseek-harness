import { readFile, writeFile } from 'node:fs/promises'

const file = new URL('../lib/assistant.js', import.meta.url)
const source = await readFile(file, 'utf8')
const opening = '(function(node_module) {'
const closing = '\n})(node_module);\n'
if (!source.startsWith(opening) || !source.endsWith(closing)) {
  throw new Error('Unexpected Harness browser bundle wrapper; refusing to patch')
}

const body = source
  .slice(opening.length, -closing.length)
  .replaceAll('(0, node_module.createRequire)', 'browserCreateRequire')
const patched = `(function() {\n\tconst browserCreateRequire = () => () => undefined${body}\n})();\n`
await writeFile(file, patched)
