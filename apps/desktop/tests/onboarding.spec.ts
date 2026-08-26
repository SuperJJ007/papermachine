// @vitest-environment jsdom
/**
 * DOM behavior of onboarding's `renderGroup`/selection state machine:
 * presence-filtered listing, version-unknown rendering, preselection
 * preserved across a re-detect that still finds the chosen candidate (and
 * falling back to the default preselect when it does not), and the
 * error-state reset. `apps/` sits outside the repository coverage gate, so
 * this suite is the only net catching a regression in `src/onboarding.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CondaCandidate } from '../src/detection.ts'
import type { DesktopOnboardingBridge } from '../src/preload.ts'

const NOTHING_DETECTED_MESSAGE = '未检测到可用环境 · No usable environment was detected.'
const DETECTION_FAILED_MESSAGE = '检测失败 · Detection failed.'
const VERSION_UNAVAILABLE = '解释器版本未知 · interpreter version unavailable'

function pythonOnly(prefix: string, pythonVersion?: string): CondaCandidate {
  return { prefix, presence: { python: true, r: false }, ...(pythonVersion === undefined ? {} : { pythonVersion }) }
}

function rOnly(prefix: string, rVersion?: string): CondaCandidate {
  return { prefix, presence: { python: false, r: true }, ...(rVersion === undefined ? {} : { rVersion }) }
}

function both(prefix: string, pythonVersion?: string, rVersion?: string): CondaCandidate {
  return {
    prefix,
    presence: { python: true, r: true },
    ...(pythonVersion === undefined ? {} : { pythonVersion }),
    ...(rVersion === undefined ? {} : { rVersion }),
  }
}

function setDom(): void {
  document.body.innerHTML = `
    <section id="python-section" hidden><div id="python-choices"></div></section>
    <section id="r-section" hidden><div id="r-choices"></div></section>
    <div id="guidance" hidden>
      <p id="guidance-message"></p>
      <p>install guidance</p>
    </div>
    <div class="actions"><button id="bind" disabled></button><button id="redetect"></button></div>
    <p id="status"></p>
  `
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector)
  if (element === null) throw new Error(`onboarding spec: missing ${selector}`)
  return element as T
}

/** Every `<label class="choice">` radio value and its rendered version text, in DOM order, None first. */
function renderedChoices(containerSelector: string): readonly { readonly value: string; readonly version: string }[] {
  return [...document.querySelectorAll(`${containerSelector} label.choice`)].map((label) => {
    const input = label.querySelector('input')
    if (!(input instanceof HTMLInputElement)) throw new Error('onboarding spec: choice missing its radio input')
    const small = label.querySelector('small')
    return { value: input.value, version: small?.textContent ?? '' }
  })
}

function checkedValue(containerSelector: string): string {
  const checked = document.querySelector<HTMLInputElement>(`${containerSelector} input:checked`)
  if (checked === null) throw new Error('onboarding spec: no radio checked')
  return checked.value
}

/** Select `value` in a rendered group by dispatching the same `change` event a real click produces. */
function choose(containerSelector: string, value: string): void {
  const input = requireElement<HTMLInputElement>(`${containerSelector} input[value="${value}"]`)
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function makeBridge(detect: DesktopOnboardingBridge['detect']): DesktopOnboardingBridge {
  return {
    onboardingStatus: vi.fn(async () => undefined),
    detect,
    bind: vi.fn(async () => {}),
  }
}

/** Load a fresh instance of the onboarding module against DOM already primed with `bridge`. */
async function loadOnboarding(bridge: DesktopOnboardingBridge): Promise<void> {
  setDom()
  ;(window as unknown as { desktopOnboarding: DesktopOnboardingBridge }).desktopOnboarding = bridge
  vi.resetModules()
  // onboarding.ts runs its initial detection as a top-level await; dynamic
  // import()'s returned promise settles only once that full module
  // evaluation (including the awaited runDetection() call) completes.
  await import('../src/onboarding.ts')
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('onboarding renderGroup', () => {
  it('lists each group by interpreter presence, not by a successful version probe', async () => {
    await loadOnboarding(makeBridge(vi.fn(async () => [
      pythonOnly('/env/py'),
      rOnly('/env/r'),
      both('/env/both', 'Python 3.11.0', 'R version 4.5.3'),
    ])))

    expect(renderedChoices('#python-choices').map(choice => choice.value)).toEqual(['', '/env/py', '/env/both'])
    expect(renderedChoices('#r-choices').map(choice => choice.value)).toEqual(['', '/env/r', '/env/both'])
  })

  it('renders a version-unavailable line for a presence-qualified candidate whose probe failed', async () => {
    await loadOnboarding(makeBridge(vi.fn(async () => [pythonOnly('/env/py')])))

    const choice = renderedChoices('#python-choices').find(entry => entry.value === '/env/py')
    expect(choice?.version).toBe(VERSION_UNAVAILABLE)
  })

  it('renders the probed version when the probe succeeded', async () => {
    await loadOnboarding(makeBridge(vi.fn(async () => [pythonOnly('/env/py', 'Python 3.11.0')])))

    const choice = renderedChoices('#python-choices').find(entry => entry.value === '/env/py')
    expect(choice?.version).toBe('Python 3.11.0')
  })

  it('preselects the first candidate in scan order on first render', async () => {
    await loadOnboarding(makeBridge(vi.fn(async () => [pythonOnly('/env/a'), pythonOnly('/env/b')])))

    expect(checkedValue('#python-choices')).toBe('/env/a')
  })

  it('preserves the user\'s prior selection across a re-detect that still finds it', async () => {
    const detect = vi.fn(async () => [pythonOnly('/env/a'), pythonOnly('/env/b')])
    await loadOnboarding(makeBridge(detect))
    expect(checkedValue('#python-choices')).toBe('/env/a')

    choose('#python-choices', '/env/b')
    expect(checkedValue('#python-choices')).toBe('/env/b')

    requireElement<HTMLButtonElement>('#redetect').click()
    await vi.waitFor(() => { expect(detect).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(checkedValue('#python-choices')).toBe('/env/b') })
  })

  it('falls back to the default preselect when the prior selection is no longer present', async () => {
    let call = 0
    const detect = vi.fn(async () => (call++ === 0
      ? [pythonOnly('/env/a'), pythonOnly('/env/b')]
      : [pythonOnly('/env/a')]))
    await loadOnboarding(makeBridge(detect))
    choose('#python-choices', '/env/b')
    expect(checkedValue('#python-choices')).toBe('/env/b')

    requireElement<HTMLButtonElement>('#redetect').click()
    await vi.waitFor(() => { expect(detect).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(checkedValue('#python-choices')).toBe('/env/a') })
  })

  it('shows the nothing-detected message and disables Bind when detection finds no candidate', async () => {
    await loadOnboarding(makeBridge(vi.fn(async () => [])))

    expect(requireElement<HTMLDivElement>('#guidance').hidden).toBe(false)
    expect(requireElement<HTMLParagraphElement>('#guidance-message').textContent).toBe(NOTHING_DETECTED_MESSAGE)
    expect(requireElement<HTMLButtonElement>('#bind').disabled).toBe(true)
  })

  it('resets to the error state on a detection failure, distinct from nothing-detected', async () => {
    let call = 0
    const detect = vi.fn(async () => {
      if (call++ === 0) return [pythonOnly('/env/a')]
      throw new Error('boom')
    })
    await loadOnboarding(makeBridge(detect))
    expect(requireElement<HTMLButtonElement>('#bind').disabled).toBe(false)

    requireElement<HTMLButtonElement>('#redetect').click()
    await vi.waitFor(() => { expect(detect).toHaveBeenCalledTimes(2) })

    await vi.waitFor(() => {
      expect(requireElement<HTMLParagraphElement>('#guidance-message').textContent).toBe(DETECTION_FAILED_MESSAGE)
    })
    expect(requireElement<HTMLDivElement>('#guidance').hidden).toBe(false)
    expect(requireElement<HTMLButtonElement>('#bind').disabled).toBe(true)
    expect(requireElement<HTMLElement>('#python-section').hidden).toBe(true)
    expect(requireElement<HTMLDivElement>('#python-choices').childElementCount).toBe(0)
  })
})
