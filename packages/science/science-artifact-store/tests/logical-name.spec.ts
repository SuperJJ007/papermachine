/** Artifact identities remain readable while materialization rejects platform aliases. */
import { describe, expect, it } from 'vitest'
import { isScienceLogicalName, isScienceMaterializationPath } from '../src/logical-name.ts'

describe('Science logical names', () => {
  it.each(['_probe/p.csv', '中文 数据/结果.csv', 'nested/report file.md'])('retains %s', (name) => {
    expect(isScienceLogicalName(name)).toBe(true)
    expect(isScienceMaterializationPath(name)).toBe(true)
  })
  it.each(['CON.txt', 'trailing.', 'AUX', 'nested/LPT1.csv', 'space ', 'CONIN$', 'CONOUT$'])('reads historical %s without materializing its alias', (name) => {
    expect(isScienceLogicalName(name)).toBe(true)
    expect(isScienceMaterializationPath(name)).toBe(false)
  })
  it.each(['', '.', '..', '../p.csv', '/p.csv', 'a//b', 'a/../b', 'C:/p.csv', 'dir/file.txt:stream', 'a\\b', 'a\u0000b', 'a\u001fb', '\ud800'])('rejects unsafe identity %j', (name) => {
    expect(isScienceLogicalName(name)).toBe(false)
    expect(isScienceMaterializationPath(name)).toBe(false)
  })
})
