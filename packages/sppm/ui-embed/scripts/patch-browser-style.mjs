import { readFile, writeFile } from 'node:fs/promises'

const file = new URL('../lib/style.css', import.meta.url)
const source = await readFile(file, 'utf8')
const scoped = source
  .replaceAll('body[data-ds-dark-theme] ', '.sppm-harness-assistant-root[data-ds-dark-theme] ')
  .replaceAll('html, body, #root', '.sppm-harness-assistant-root')
  .replaceAll('body {', '.sppm-harness-assistant-root {')
  .replaceAll('button, input, select, textarea {', '.sppm-harness-assistant-root button, .sppm-harness-assistant-root input, .sppm-harness-assistant-root select, .sppm-harness-assistant-root textarea {')
  .replaceAll('code, pre, [data-diff], [data-read], [data-search], [data-terminal] {', '.sppm-harness-assistant-root code, .sppm-harness-assistant-root pre, .sppm-harness-assistant-root [data-diff], .sppm-harness-assistant-root [data-read], .sppm-harness-assistant-root [data-search], .sppm-harness-assistant-root [data-terminal] {')

await writeFile(file, scoped)
