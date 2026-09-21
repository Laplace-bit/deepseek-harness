import { describe, expect, it } from 'vitest'
import { parseSppmIdentity } from '../src/identity.ts'

describe('SPPM identity responses', () => {
  it('reads the existing RuoYi getInfo response', () => {
    expect(parseSppmIdentity({ code: 200, user: { userId: 7, nickName: 'Operator' }, roles: ['operator'], permissions: [] }))
      .toEqual({ userId: '7', displayName: 'Operator', roles: ['operator'] })
  })
  it('rejects business failures even when identity fields are present', () => {
    expect(parseSppmIdentity({ code: 401, user: { userId: 7 }, roles: ['admin'] })).toBeNull()
    expect(parseSppmIdentity({ code: 500, userId: 7, roles: ['admin'] })).toBeNull()
  })
  it('preserves existing flat and wrapped identity responses', () => {
    expect(parseSppmIdentity({ userId: '7', roles: ['user'] })).toEqual({ userId: '7', roles: ['user'] })
    expect(parseSppmIdentity({ data: { userId: 7, admin: true } })).toEqual({ userId: '7', roles: ['admin'] })
  })
  it('rejects missing identity and malformed roles', () => {
    for (const value of [null, [], {}, { code: 401 }, { user: { userId: 7 } }, { userId: {}, roles: [] }, { userId: 7, roles: [1] }]) {
      expect(parseSppmIdentity(value)).toBeNull()
    }
  })
})
