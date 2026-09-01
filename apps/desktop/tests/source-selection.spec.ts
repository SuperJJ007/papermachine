import { describe, expect, it } from 'vitest'
import type { EnvironmentSource } from '../src/environment-declaration.ts'
import { CHINA_MIRROR_SOURCE_ID, OFFICIAL_SOURCE_ID, resolveDefaultSourceId } from '../src/source-selection.ts'

const SOURCES: readonly EnvironmentSource[] = [
  { id: 'tuna', name: 'TUNA mirror', channels: ['https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge'] },
  { id: 'ustc', name: 'USTC mirror', channels: ['https://mirrors.ustc.edu.cn/anaconda/cloud/conda-forge'] },
  { id: 'official', name: 'Official channel', channels: ['https://conda.anaconda.org/conda-forge'] },
]

describe('resolveDefaultSourceId', () => {
  it('defaults to the TUNA mirror when the system timezone is Asia/Shanghai', () => {
    expect(resolveDefaultSourceId(SOURCES, { timeZone: 'Asia/Shanghai', languages: ['en-US'] }))
      .toBe(CHINA_MIRROR_SOURCE_ID)
  })

  it('defaults to the TUNA mirror when a preferred language is Chinese, regardless of timezone', () => {
    expect(resolveDefaultSourceId(SOURCES, { timeZone: 'America/New_York', languages: ['zh-CN', 'en-US'] }))
      .toBe(CHINA_MIRROR_SOURCE_ID)
    expect(resolveDefaultSourceId(SOURCES, { timeZone: 'America/New_York', languages: ['zh-TW'] }))
      .toBe(CHINA_MIRROR_SOURCE_ID)
  })

  it('defaults to the official channel for a non-Chinese timezone and language', () => {
    expect(resolveDefaultSourceId(SOURCES, { timeZone: 'America/New_York', languages: ['en-US'] }))
      .toBe(OFFICIAL_SOURCE_ID)
  })

  it('defaults to the official channel for an empty languages list outside Shanghai', () => {
    expect(resolveDefaultSourceId(SOURCES, { timeZone: 'Europe/Berlin', languages: [] }))
      .toBe(OFFICIAL_SOURCE_ID)
  })

  it('is deterministic from system settings alone: the same signals always resolve to the same source', () => {
    const signals = { timeZone: 'Asia/Shanghai', languages: ['en-US'] }
    expect(resolveDefaultSourceId(SOURCES, signals)).toBe(resolveDefaultSourceId(SOURCES, { ...signals }))
  })

  it('falls back to the first listed source when the preferred id is absent from the declaration', () => {
    const withoutTuna = SOURCES.filter(source => source.id !== 'tuna')
    expect(resolveDefaultSourceId(withoutTuna, { timeZone: 'Asia/Shanghai', languages: [] })).toBe('ustc')
  })

  it('throws rather than silently choosing when sources is empty', () => {
    expect(() => resolveDefaultSourceId([], { timeZone: 'Asia/Shanghai', languages: [] })).toThrow(/sources must not be empty/)
  })
})
