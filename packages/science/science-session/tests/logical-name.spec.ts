/** Logical artifact paths retain filesystem names through durable decoding. */
import { describe, expect, it } from 'vitest'
import { decodeScienceArtifact } from '../src/index.ts'
import { artifact } from './fixtures.ts'

describe('Science logical artifact paths', () => {
  it.each(['_probe/p.csv', '中文 数据/结果.csv', 'nested/deeper/report file.md', 'CON.txt', 'trailing.'])(
    'decodes the captured path %s without rewriting it', (logicalName) => {
      expect(decodeScienceArtifact(artifact({ logicalName })).logicalName).toBe(logicalName)
    },
  )
})
