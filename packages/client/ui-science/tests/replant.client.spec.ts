import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

it('refuses Science browser activation until public sidebar integration is available', () => {
  expect(() => apply(new Context())).toThrow('Science browser migration is pending (P4)')
})
