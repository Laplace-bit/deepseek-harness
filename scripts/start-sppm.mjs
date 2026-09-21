/** Start the local SPPM gateway with persistent development configuration. */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
try {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (!(major === 22 && minor >= 19 || major >= 24)) throw new Error('Use Node ^22.19.0 or >=24.0.0.')
  const config = join(root, '.data/sppm.env')
  if (existsSync(config)) {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(config, 'utf8')))) {
      if (key.startsWith('SPPM_') || key === 'NODE_ENV') process.env[key] ??= value
    }
  }
  if (process.env.NODE_ENV === 'production') throw new Error('start-sppm.sh is for local development, not production.')
  process.env.SPPM_GATEWAY_HOST ??= '127.0.0.1'
  if (!['127.0.0.1', '::1', 'localhost'].includes(process.env.SPPM_GATEWAY_HOST)) throw new Error('Local startup requires a loopback SPPM_GATEWAY_HOST.')
  process.env.SPPM_GATEWAY_PORT ??= '3180'
  const port = Number(process.env.SPPM_GATEWAY_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SPPM_GATEWAY_PORT must be an integer from 1 to 65535.')
  process.env.SPPM_SECURE_COOKIE ??= 'false'
  process.env.SPPM_HARNESS_ENTRY = resolve(root, process.env.SPPM_HARNESS_ENTRY ?? 'apps/cli/src/bin.ts')
  if (!existsSync(process.env.SPPM_HARNESS_ENTRY)) throw new Error('SPPM_HARNESS_ENTRY does not exist.')
  if (!existsSync(join(root, 'node_modules/tsx'))) throw new Error('Dependencies are missing. Run pnpm install first.')
  if (!process.env.SPPM_AUTH_INTROSPECTION_URL) {
    const proxy = join(root, '../frontend/proxy.config.json')
    if (!existsSync(proxy)) throw new Error('Set SPPM_AUTH_INTROSPECTION_URL in .data/sppm.env; frontend/proxy.config.json was not found.')
    const { target } = JSON.parse(readFileSync(proxy, 'utf8'))
    if (typeof target !== 'string') throw new Error('frontend/proxy.config.json must define target.')
    process.env.SPPM_AUTH_INTROSPECTION_URL = `${target.trim().replace(/\/$/u, '')}/getInfo`
  }
  const identity = new URL(process.env.SPPM_AUTH_INTROSPECTION_URL)
  if (!['http:', 'https:'].includes(identity.protocol) || identity.username || identity.password) throw new Error('Identity URL must be HTTP(S), without embedded credentials.')
  if (!process.env.SPPM_GATEWAY_COOKIE_SECRET) {
    const directory = join(root, '.data/sppm-local')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const secretFile = join(directory, 'cookie-secret')
    try {
      writeFileSync(secretFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    process.env.SPPM_GATEWAY_COOKIE_SECRET = readFileSync(secretFile, 'utf8').trim()
    if (process.env.SPPM_GATEWAY_COOKIE_SECRET.length < 32) throw new Error('Local cookie-secret is invalid; configure SPPM_GATEWAY_COOKIE_SECRET explicitly.')
  }
  console.log(`SPPM local gateway: ${process.env.SPPM_GATEWAY_HOST}:${port}`)
  console.log(`Identity endpoint: ${identity.origin}${identity.pathname}`)
  console.log('Open the logged-in Vue page after the listening message. Ctrl+C stops this gateway and its Harness children.')
  await import('../packages/sppm/gateway/src/server.ts')
} catch (error) {
  console.error(`SPPM startup failed: ${error.code === 'EADDRINUSE' ? 'Gateway port is occupied; stop its owning terminal or choose SPPM_GATEWAY_PORT.' : error.message}`)
  process.exitCode = 1
}
