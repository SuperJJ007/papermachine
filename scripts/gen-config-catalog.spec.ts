import { describe, expect, it } from 'vitest'
import { collectConfigCatalog } from './gen-config-catalog.ts'

describe('gen-config-catalog imported schema resolution', () => {
  it('follows a same-package imported configSchema on Science Runtime', () => {
    const entry = collectConfigCatalog().find(item => item.pkg === '@deepseek-ai/dsh-science-runtime')
    expect(entry?.kind).toBe('config')
    expect(entry?.schemaKeys).toEqual(expect.arrayContaining(['dshHome', 'profiles', 'timeoutMs']))
  })
})
