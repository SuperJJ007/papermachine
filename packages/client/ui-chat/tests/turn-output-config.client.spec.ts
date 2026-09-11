/** Deployment configuration rejects malformed boot values and agrees with the Host schema. */
import { afterEach, expect, it, vi } from 'vitest'
import { Config } from '../src/index.ts'
import { readTurnOutputCollapsedCount, TURN_OUTPUT_COUNT_GLOBAL } from '../src/turn-output-config.ts'

afterEach(() => { vi.unstubAllGlobals() })

it('uses four only when the boot field is absent', () => {
  vi.stubGlobal(TURN_OUTPUT_COUNT_GLOBAL, undefined)
  expect(readTurnOutputCollapsedCount()).toBe(4)
  expect(Config({} as never)).toEqual({ turnOutputCollapsedCount: 4 })
})

it.each([1, 4, 9, Number.MAX_SAFE_INTEGER])('shares a validated count of %i', (count) => {
  expect(Config({ turnOutputCollapsedCount: count }).turnOutputCollapsedCount).toBe(count)
  vi.stubGlobal(TURN_OUTPUT_COUNT_GLOBAL, count)
  expect(readTurnOutputCollapsedCount()).toBe(count)
})

/** Malformed wire values intentionally bypass the typed same-process input. */
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '4', null])('rejects invalid wire value %s', (count) => {
  vi.stubGlobal(TURN_OUTPUT_COUNT_GLOBAL, count)
  expect(readTurnOutputCollapsedCount).toThrow('positive integer')
  if (count === null) expect(Config({ turnOutputCollapsedCount: count } as never).turnOutputCollapsedCount).toBe(4)
  else expect(() => Config({ turnOutputCollapsedCount: count } as never)).toThrow()
})
