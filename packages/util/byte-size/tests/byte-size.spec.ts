import { describe, expect, it } from 'vitest'
import { formatBytes } from '@deepseek-ai/dsh-byte-size'

describe('formatBytes', () => {
  it('renders a sub-1024 count in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('renders a sub-1 MiB count in kilobytes to one decimal place', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB')
  })

  it('renders a 1 MiB-or-larger count in megabytes to one decimal place', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
