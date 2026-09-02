import { describe, expect, it } from 'vitest'
import { WINDOW_BACKGROUND, windowBackgroundColor } from '../src/window-theme.ts'

describe('windowBackgroundColor', () => {
  it('selects the light fallback for a resolved light system theme', () => {
    expect(windowBackgroundColor(false)).toBe(WINDOW_BACKGROUND.light)
  })

  it('selects the dark fallback for a resolved dark system theme', () => {
    expect(windowBackgroundColor(true)).toBe(WINDOW_BACKGROUND.dark)
  })
})
