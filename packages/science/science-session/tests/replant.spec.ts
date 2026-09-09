import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { apply } from '../src/index.ts'

it('refuses Science projection activation until checkpoint admission is migrated', () => {
  expect(() => apply(new Context())).toThrow('P2: Science checkpoint admission')
})
