// @vitest-environment jsdom
/**
 * DOM behavior of onboarding's single install route: the confirm panel's
 * size/disk statement and package-source picker, the standard and custom
 * provisioning paths, progress rendering, and failure recovery. `apps/`
 * sits outside the repository coverage gate, so this suite is the only net
 * catching a regression in `src/onboarding.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopOnboardingBridge, OfferedEnvironment } from '../src/preload.ts'
import type { ProvisioningProgress } from '../src/provisioning.ts'

const STANDARD: OfferedEnvironment = {
  id: 'general',
  name: 'General science',
  revision: '2026.09.1',
  packages: ['python=3.13', 'numpy=2.3', 'r-base=4.5'],
  estimatedDownloadBytes: 520_000_000,
  requiredFreeBytes: 6_000_000_000,
  sources: [
    { id: 'tuna', name: 'TUNA mirror' },
    { id: 'ustc', name: 'USTC mirror' },
    { id: 'official', name: 'Official channel' },
  ],
  defaultSourceId: 'official',
}

function setDom(): void {
  document.body.innerHTML = `
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
      <div id="confirm-sources"></div>
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

function checkedValue(containerSelector: string): string {
  const checked = document.querySelector<HTMLInputElement>(`${containerSelector} input:checked`)
  if (checked === null) throw new Error('onboarding spec: no radio checked')
  return checked.value
}

/** Select `value` in the confirm panel's source group by dispatching the same `change` event a real click produces. */
function chooseSource(value: string): void {
  const input = requireElement(`#confirm-sources input[value="${value}"]`) as HTMLInputElement
  input.checked = true
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** The provisioning-progress listener the loaded module subscribed with, for tests that drive progress. */
let progressListener: ((progress: ProvisioningProgress) => void) | undefined

function makeBridge(overrides: Partial<DesktopOnboardingBridge> = {}): DesktopOnboardingBridge {
  return {
    onboardingStatus: vi.fn(async () => undefined),
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
  // onboarding.ts runs its initial environment load as a top-level await;
  // dynamic import()'s returned promise settles only once that full module
  // evaluation (including the awaited loadEnvironments() call) completes.
  await import('../src/onboarding.ts')
}

beforeEach(() => {
  document.body.innerHTML = ''
  progressListener = undefined
})

/** A bridge whose install-route calls are held as locals, so assertions never reference a bridge method unbound. */
function installBridge(overrides: Partial<DesktopOnboardingBridge> = {}) {
  const provision = vi.fn(async (_id: string, _sourceId: string) => {})
  const provisionCustom = vi.fn(async (_packages: readonly string[], _sourceId: string) => {})
  const cancelProvisioning = vi.fn(async () => {})
  const bridge = makeBridge({ provision, provisionCustom, cancelProvisioning, ...overrides })
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

  it('preselects the offered default source in the confirm panel', async () => {
    const { bridge } = installBridge()
    await loadOnboarding(bridge)

    click('#provision')

    expect(checkedValue('#confirm-sources')).toBe('official')
    expect([...document.querySelectorAll('#confirm-sources label')].map(label => label.textContent)).toEqual([
      'TUNA mirror', 'USTC mirror', 'Official channel',
    ])
  })

  it('downloads the shipped environment with the preselected source after confirmation', async () => {
    const { bridge, provision } = installBridge()
    await loadOnboarding(bridge)

    click('#provision')
    click('#confirm-start')

    await vi.waitFor(() => { expect(provision).toHaveBeenCalledWith('general', 'official') })
    expect(hiddenState('#confirm')).toBe(true)
    expect(hiddenState('#progress')).toBe(false)
  })

  it('downloads with the source the user picked instead of the default', async () => {
    const { bridge, provision } = installBridge()
    await loadOnboarding(bridge)

    click('#provision')
    chooseSource('tuna')
    click('#confirm-start')

    await vi.waitFor(() => { expect(provision).toHaveBeenCalledWith('general', 'tuna') })
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

  it('sends the edited list, trimmed and without blank lines, through the custom route with the chosen source', async () => {
    const { bridge, provision, provisionCustom } = installBridge()
    await loadOnboarding(bridge)

    ;(requireElement('#custom-packages') as HTMLTextAreaElement).value = '  python=3.13 \n\n scipy\n'
    click('#provision-custom')
    chooseSource('tuna')
    click('#confirm-start')

    await vi.waitFor(() => { expect(provisionCustom).toHaveBeenCalledWith(['python=3.13', 'scipy'], 'tuna') })
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

  it('offers no bind-an-existing-environment route: the bridge exposes only the install methods', async () => {
    const { bridge } = installBridge()
    await loadOnboarding(bridge)

    expect(Object.keys(bridge).sort()).toEqual([
      'cancelProvisioning', 'environments', 'onProvisioningProgress', 'onboardingStatus', 'provision', 'provisionCustom',
    ])
    expect(document.querySelector('#detected')).toBeNull()
    expect(document.querySelector('#bind')).toBeNull()
    expect(document.querySelector('#redetect')).toBeNull()
  })
})
