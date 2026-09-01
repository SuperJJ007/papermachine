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
import type { DesktopOnboardingBridge, OfferedEnvironment } from '../src/preload.ts'
import type { ProvisioningProgress } from '../src/provisioning.ts'

const NOTHING_DETECTED_MESSAGE = '未检测到本机环境，可以直接安装下面的标准环境。 · No environment was found on this machine; install the standard one below.'
const DETECTION_FAILED_MESSAGE = '检测失败，仍可安装下面的标准环境。 · Detection failed; the standard environment below can still be installed.'
const VERSION_UNAVAILABLE = '解释器版本未知 · interpreter version unavailable'

const STANDARD: OfferedEnvironment = {
  id: 'general',
  name: 'General science',
  revision: '2026.09.1',
  packages: ['python=3.13', 'numpy=2.3', 'r-base=4.5'],
  estimatedDownloadBytes: 520_000_000,
  requiredFreeBytes: 6_000_000_000,
}

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
    <section id="detected" hidden>
      <section id="python-section" hidden><div id="python-choices"></div></section>
      <section id="r-section" hidden><div id="r-choices"></div></section>
      <div class="actions"><button id="bind" disabled></button><button id="redetect"></button></div>
    </section>
    <div id="guidance" hidden>
      <p id="guidance-message"></p>
    </div>
    <section id="install">
      <p id="install-summary"></p>
      <ul id="packages"></ul>
      <details id="advanced"><summary>advanced</summary><textarea id="custom-packages"></textarea></details>
      <div class="actions">
        <button id="provision"></button>
        <button id="provision-custom" hidden></button>
      </div>
    </section>
    <section id="confirm" hidden>
      <p id="confirm-detail"></p>
      <div class="actions"><button id="confirm-start"></button><button id="confirm-cancel"></button></div>
    </section>
    <section id="progress" hidden>
      <p id="progress-phase"></p>
      <p id="progress-message"></p>
      <div class="actions"><button id="cancel"></button></div>
    </section>
    <p id="status"></p>
  `
}

function requireElement(selector: string): Element {
  const element = document.querySelector(selector)
  if (element === null) throw new Error(`onboarding spec: missing ${selector}`)
  return element
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
  const input = requireElement(`${containerSelector} input[value="${value}"]`) as HTMLInputElement
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** The provisioning-progress listener the loaded module subscribed with, for tests that drive progress. */
let progressListener: ((progress: ProvisioningProgress) => void) | undefined

function makeBridge(
  detect: DesktopOnboardingBridge['detect'],
  overrides: Partial<DesktopOnboardingBridge> = {},
): DesktopOnboardingBridge {
  return {
    onboardingStatus: vi.fn(async () => undefined),
    detect,
    bind: vi.fn(async () => {}),
    environments: vi.fn(async () => [STANDARD]),
    provision: vi.fn(async () => {}),
    provisionCustom: vi.fn(async () => {}),
    cancelProvisioning: vi.fn(async () => {}),
    onProvisioningProgress: (listener) => { progressListener = listener },
    ...overrides,
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
  progressListener = undefined
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

    ;(requireElement('#redetect') as HTMLButtonElement).click()
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

    ;(requireElement('#redetect') as HTMLButtonElement).click()
    await vi.waitFor(() => { expect(detect).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(checkedValue('#python-choices')).toBe('/env/a') })
  })

  it('shows the nothing-detected message and disables Bind when detection finds no candidate', async () => {
    await loadOnboarding(makeBridge(vi.fn(async () => [])))

    expect((requireElement('#guidance') as HTMLDivElement).hidden).toBe(false)
    expect((requireElement('#guidance-message') as HTMLParagraphElement).textContent).toBe(NOTHING_DETECTED_MESSAGE)
    expect((requireElement('#bind') as HTMLButtonElement).disabled).toBe(true)
  })

  it('resets to the error state on a detection failure, distinct from nothing-detected', async () => {
    let call = 0
    const detect = vi.fn(async () => {
      if (call++ === 0) return [pythonOnly('/env/a')]
      throw new Error('boom')
    })
    await loadOnboarding(makeBridge(detect))
    expect((requireElement('#bind') as HTMLButtonElement).disabled).toBe(false)

    ;(requireElement('#redetect') as HTMLButtonElement).click()
    await vi.waitFor(() => { expect(detect).toHaveBeenCalledTimes(2) })

    await vi.waitFor(() => {
      expect((requireElement('#guidance-message') as HTMLParagraphElement).textContent).toBe(DETECTION_FAILED_MESSAGE)
    })
    expect((requireElement('#guidance') as HTMLDivElement).hidden).toBe(false)
    expect((requireElement('#bind') as HTMLButtonElement).disabled).toBe(true)
    expect((requireElement('#python-section') as HTMLElement).hidden).toBe(true)
    expect((requireElement('#python-choices') as HTMLDivElement).childElementCount).toBe(0)
  })
})


/** A bridge whose install-route calls are held as locals, so assertions never reference a bridge method unbound. */
function installBridge(overrides: Partial<DesktopOnboardingBridge> = {}) {
  const provision = vi.fn(async (_id: string) => {})
  const provisionCustom = vi.fn(async (_packages: readonly string[]) => {})
  const cancelProvisioning = vi.fn(async () => {})
  const bridge = makeBridge(vi.fn(async () => []), {
    provision, provisionCustom, cancelProvisioning, ...overrides,
  })
  return { bridge, provision, provisionCustom, cancelProvisioning }
}

function click(selector: string): void {
  (requireElement(selector) as HTMLButtonElement).click()
}

function textOf(selector: string): string {
  return requireElement(selector).textContent ?? ''
}

/** `HTMLElement.hidden` also models the `until-found` string value, which none of this page's controls use. */
function hiddenState(selector: string): boolean {
  return (requireElement(selector) as HTMLElement).hidden === true
}

describe('onboarding install route', () => {
  it('states the download size, disk requirement, and package count before any download starts', async () => {
    const { bridge, provision } = installBridge()
    await loadOnboarding(bridge)

    expect(textOf('#install-summary')).toContain('520 MB')
    expect(textOf('#install-summary')).toContain('6.0 GB')
    expect(provision).not.toHaveBeenCalled()
  })

  it('lists the shipped packages and prefills the custom editor with exactly that list', async () => {
    const { bridge } = installBridge()
    await loadOnboarding(bridge)

    expect([...document.querySelectorAll('#packages li')].map(item => item.textContent)).toEqual(STANDARD.packages)
    expect((requireElement('#custom-packages') as HTMLTextAreaElement).value).toBe(STANDARD.packages.join('\n'))
  })

  it('asks for confirmation naming the size instead of downloading on the first click', async () => {
    const { bridge, provision } = installBridge()
    await loadOnboarding(bridge)

    click('#provision')

    expect(hiddenState('#confirm')).toBe(false)
    expect(textOf('#confirm-detail')).toContain('520 MB')
    expect(provision).not.toHaveBeenCalled()
  })

  it('downloads the shipped environment only after the confirmation is accepted', async () => {
    const { bridge, provision } = installBridge()
    await loadOnboarding(bridge)

    click('#provision')
    click('#confirm-start')

    await vi.waitFor(() => { expect(provision).toHaveBeenCalledWith('general') })
    expect(hiddenState('#confirm')).toBe(true)
    expect(hiddenState('#progress')).toBe(false)
  })

  it('starts nothing when the confirmation is dismissed', async () => {
    const { bridge, provision } = installBridge()
    await loadOnboarding(bridge)

    click('#provision')
    click('#confirm-cancel')
    click('#confirm-start')

    expect(hiddenState('#confirm')).toBe(true)
    expect(provision).not.toHaveBeenCalled()
  })

  it('sends the edited list, trimmed and without blank lines, through the custom route', async () => {
    const { bridge, provision, provisionCustom } = installBridge()
    await loadOnboarding(bridge)

    ;(requireElement('#custom-packages') as HTMLTextAreaElement).value = '  python=3.13 \n\n scipy\n'
    click('#provision-custom')
    click('#confirm-start')

    await vi.waitFor(() => { expect(provisionCustom).toHaveBeenCalledWith(['python=3.13', 'scipy']) })
    expect(provision).not.toHaveBeenCalled()
  })

  it('refuses an empty custom list without asking for confirmation', async () => {
    const { bridge, provisionCustom } = installBridge()
    await loadOnboarding(bridge)

    ;(requireElement('#custom-packages') as HTMLTextAreaElement).value = '   \n\n'
    click('#provision-custom')

    expect(hiddenState('#confirm')).toBe(true)
    expect(textOf('#status')).toBe('自定义清单不能为空 · The custom list cannot be empty.')
    expect(provisionCustom).not.toHaveBeenCalled()
  })

  it('reveals the custom install button only while the advanced editor is open', async () => {
    const { bridge } = installBridge()
    await loadOnboarding(bridge)
    const advanced = requireElement('#advanced') as HTMLDetailsElement
    expect(hiddenState('#provision-custom')).toBe(true)

    advanced.open = true
    advanced.dispatchEvent(new Event('toggle'))
    expect(hiddenState('#provision-custom')).toBe(false)

    advanced.open = false
    advanced.dispatchEvent(new Event('toggle'))
    expect(hiddenState('#provision-custom')).toBe(true)
  })

  it('renders each provisioning progress update', async () => {
    const { bridge } = installBridge()
    await loadOnboarding(bridge)

    progressListener?.({ phase: 'installing', message: 'downloading scipy' })

    expect(hiddenState('#progress')).toBe(false)
    expect(textOf('#progress-phase')).toBe('installing')
    expect(textOf('#progress-message')).toBe('downloading scipy')
  })

  it('surfaces a failed download and returns the page to a usable state', async () => {
    const { bridge } = installBridge({ provision: vi.fn(async () => { throw new Error('solve failed') }) })
    await loadOnboarding(bridge)

    click('#provision')
    click('#confirm-start')

    await vi.waitFor(() => { expect(textOf('#status')).toBe('solve failed') })
    expect(hiddenState('#progress')).toBe(true)
    expect((requireElement('#provision') as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables Install when the environment list cannot be read, and says why', async () => {
    const { bridge } = installBridge({ environments: vi.fn(async () => { throw new Error('no declarations') }) })
    await loadOnboarding(bridge)

    expect(textOf('#install-summary')).toBe('no declarations')
    expect((requireElement('#provision') as HTMLButtonElement).disabled).toBe(true)
  })

  it('cancels an in-flight download through the bridge', async () => {
    const { bridge, cancelProvisioning } = installBridge()
    await loadOnboarding(bridge)

    click('#provision')
    click('#confirm-start')
    click('#cancel')

    expect(cancelProvisioning).toHaveBeenCalled()
  })

  it('hides the detected section entirely when nothing was found, leaving install as the only route', async () => {
    const { bridge } = installBridge()
    await loadOnboarding(bridge)

    expect(hiddenState('#detected')).toBe(true)
    expect(textOf('#guidance-message')).toBe(NOTHING_DETECTED_MESSAGE)
    expect((requireElement('#provision') as HTMLButtonElement).disabled).toBe(false)
  })
})
