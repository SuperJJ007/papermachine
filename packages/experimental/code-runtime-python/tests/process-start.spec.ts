/** Linux process-identity parsing at the procfs boundary; real process reads remain in runtime.spec.ts. */
import { afterEach, expect, it, vi } from 'vitest'
import { readProcessStart } from '../src/index.ts'

const { readStat } = vi.hoisted(() => ({ readStat: vi.fn<() => string>() }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (args[0] === '/proc/731/stat') {
        expect(args[1]).toBe('utf8')
        return readStat()
      }
      return actual.readFileSync(...args)
    },
  }
})

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  readStat.mockReset()
})

it('distinguishes process generations with the same pid and a name containing closing parentheses', () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
  // Fields 3–21 precede starttime; comm is allowed to contain spaces and parentheses.
  readStat.mockReturnValue('731 (worker ) name)) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654321 4096')
  expect(readProcessStart(731)).toBe('987654321')
  readStat.mockReturnValue('731 (replacement) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654322 4096')
  expect(readProcessStart(731)).toBe('987654322')
})

it.each(['ENOENT', 'EACCES'])('leaves process identity unavailable when procfs reports %s', (code) => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
  readStat.mockImplementation(() => { throw Object.assign(new Error('procfs read failed'), { code }) })
  expect(readProcessStart(731)).toBeUndefined()
})
