import type { SppmPrincipal } from './index.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse SPPM identity responses, including RuoYi getInfo business status.
 * @param value Untrusted JSON returned by the configured identity endpoint.
 * @returns The authenticated principal, or null for failed or invalid responses.
 */
export function parseSppmIdentity(value: unknown): SppmPrincipal | null {
  if (!record(value) || (value.code !== undefined && value.code !== 200)) return null
  const identity = record(value.user) ? value.user : record(value.data) ? value.data : value
  const roles = record(value.user) ? value.roles : identity.roles ?? (identity.admin === true ? ['admin'] : record(value.data) ? ['user'] : undefined)
  if ((typeof identity.userId !== 'string' && typeof identity.userId !== 'number') || String(identity.userId).trim() === '') return null
  if (typeof identity.userId === 'number' && !Number.isFinite(identity.userId)) return null
  if (!Array.isArray(roles) || !roles.every(role => typeof role === 'string')) return null
  const displayName = identity.displayName ?? identity.nickName ?? identity.userName
  return { userId: String(identity.userId), roles, ...(typeof displayName === 'string' ? { displayName } : {}) }
}
