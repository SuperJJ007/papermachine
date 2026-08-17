// @vitest-environment jsdom
/**
 * The Science settings card's rendering: its own collapsed-by-default
 * disclosure (equivalent in behavior and accessible naming to the Plugins
 * section's sibling cards, owned locally rather than imported), the eight
 * reachable states once expanded (loading, unconfigured, configured, saving,
 * a Host-rejected/stale-revision write, a client-blocked invalid draft,
 * saved-restart-required, and reset-to-composition), accessible names and
 * distinct accessible text per state, and one end-to-end save through the
 * real controller.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { ScienceSettingsCard, type ScienceSettingsCardProps } from '../src/client/ScienceSettingsCard.tsx'
import {
  ScienceSettingsCardController, type ScienceRuntimeSettingsSection, type ScienceSettingsCardState,
} from '../src/client/settings-card-controller.ts'
import { en } from '../src/client/locales.ts'

/** A sentinel absolute path standing in for a real Conda prefix: it must never surface in the DOM. */
const SENTINEL = '/sentinel-1e7c4a/should-never-render'

const t = makeTranslate(en) as ScienceSettingsCardProps['t']

afterEach(cleanup)

const field = (over: Partial<ScienceSettingsCardState['pythonPrefix']> = {}) => ({
  text: '', configured: false, invalid: false, ...over,
})

const settled: ScienceSettingsCardState = {
  loading: false,
  writable: true,
  configured: false,
  overridden: false,
  pythonPrefix: field(),
  rPrefix: field(),
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
  restartRequired: false,
}

function actions() {
  return { edit: vi.fn(), save: vi.fn(), discard: vi.fn(), reset: vi.fn() }
}

/** The card's own disclosure toggle, addressed the same way in every state. */
function toggle(name: 'Show settings: Science' | 'Hide settings: Science' = 'Show settings: Science') {
  return screen.getByRole('button', { name })
}

/**
 * Render the card over one hand-built, static state (mirrors the sibling
 * section's own card-render idiom). Expands it by default: every state test
 * below exercises what is visible once open, and collapsed-by-default gets
 * its own dedicated coverage.
 */
function renderCard(
  state: Partial<ScienceSettingsCardState> = {},
  over: Partial<ScienceSettingsCardProps> = {},
  options: { open?: boolean } = {},
) {
  const props = {
    t,
    useScienceSettingsCard: (sel: (s: ScienceSettingsCardState) => unknown) => sel({ ...settled, ...state }),
    ...actions(),
    ...over,
  } as unknown as ScienceSettingsCardProps
  const view = render(<ScienceSettingsCard {...props} />)
  if (options.open !== false) fireEvent.click(toggle())
  return { view, props }
}

function statusTexts(): string[] {
  return screen.getAllByRole('status').map(el => el.textContent ?? '')
}

describe('ScienceSettingsCard: collapsed by default', () => {
  it('shows only the header — no field, hint, status, or action button — until expanded', () => {
    renderCard({}, {}, { open: false })
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Science')).toBeTruthy()
    expect(screen.getByText('Conda prefixes for the fixed science profile.')).toBeTruthy()
    expect(screen.queryByLabelText('Python prefix')).toBeNull()
    expect(screen.queryByLabelText('R prefix')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('exposes the expanded state to assistive technology and reveals the fields once toggled', () => {
    renderCard({}, {}, { open: false })
    fireEvent.click(toggle())
    expect(toggle('Hide settings: Science').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('Python prefix')).toBeTruthy()
    expect(screen.getByLabelText('R prefix')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    fireEvent.click(toggle('Hide settings: Science'))
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('Python prefix')).toBeNull()
  })
})

describe('ScienceSettingsCard: loading', () => {
  it('shows a loading status and no fields, before the first accepted section', () => {
    const { view } = renderCard({ loading: true })
    expect(statusTexts()).toEqual(['Loading…'])
    expect(view.container.querySelector('#science-settings-python-prefix')).toBeNull()
    expect(view.container.querySelector('#science-settings-r-prefix')).toBeNull()
  })
})

describe('ScienceSettingsCard: unconfigured', () => {
  it('shows the unconfigured hint and a "Not configured" badge on both fields', () => {
    renderCard({ configured: false })
    expect(statusTexts()).toEqual(['No science profile is configured yet; fill in at least one prefix and save.'])
    expect(screen.getAllByText('Not configured')).toHaveLength(2)
  })
})

describe('ScienceSettingsCard: configured', () => {
  it('shows a neutral "Configured" badge per field and never echoes a stored value into the input', () => {
    renderCard({ configured: true, pythonPrefix: field({ configured: true }), rPrefix: field({ configured: false }) })
    expect(screen.queryAllByRole('status')).toHaveLength(0)
    expect(screen.getByText('Configured')).toBeTruthy()
    expect(screen.getByText('Not configured')).toBeTruthy()
    const pythonInput = screen.getByLabelText<HTMLInputElement>('Python prefix')
    expect(pythonInput.value).toBe('')
  })

  it('renders whatever staged text it is given, and a freshly-loaded configured field never carries a sentinel', () => {
    // The card renders staged draft text verbatim (the user's own current
    // keystrokes) — this proves that path is the ONLY way text can appear in
    // the input, so a freshly-loaded configured field with no staged draft
    // (the common case) never carries a stored prefix.
    const { view: staged } = renderCard({ configured: true, pythonPrefix: field({ configured: true, text: SENTINEL }) })
    expect((staged.container.querySelector('#science-settings-python-prefix') as HTMLInputElement).value).toBe(SENTINEL)
    cleanup()
    const { view: fresh } = renderCard({ configured: true, pythonPrefix: field({ configured: true }) })
    expect(fresh.container.textContent).not.toContain(SENTINEL)
    expect((fresh.container.querySelector('#science-settings-python-prefix') as HTMLInputElement).value).toBe('')
  })
})

describe('ScienceSettingsCard: read-only deployment', () => {
  it('shows the read-only status and disables the inputs', () => {
    renderCard({ configured: true, writable: false, pythonPrefix: field({ configured: true }) })
    expect(statusTexts()).toEqual(['This deployment stores settings read-only.'])
    expect(screen.getByLabelText<HTMLInputElement>('Python prefix').disabled).toBe(true)
  })
})

describe('ScienceSettingsCard: saving', () => {
  it('disables the inputs and save/discard controls and labels the save button "Saving…"', () => {
    renderCard({
      configured: true, saving: true, dirty: true,
      pythonPrefix: field({ configured: true, text: '/opt/conda/envs/science' }),
    })
    expect(screen.getByLabelText<HTMLInputElement>('Python prefix').disabled).toBe(true)
    const saveButton = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
    const discardButton = screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement
    expect(discardButton.disabled).toBe(true)
  })
})

describe('ScienceSettingsCard: a Host-rejected write (stale revision)', () => {
  it('shows the save-failed status distinct from every other notice', () => {
    renderCard({ configured: true, failed: true, pythonPrefix: field({ configured: true, text: SENTINEL }) })
    expect(statusTexts()).toEqual(['The deployment did not accept these values; they were left for you to correct.'])
  })
})

describe('ScienceSettingsCard: validation-failure', () => {
  it('marks the invalid field aria-invalid, shows the absolute-path hint, and disables save', () => {
    renderCard({
      dirty: true, invalid: true,
      pythonPrefix: field({ text: 'relative/conda', invalid: true }),
    })
    const input = screen.getByLabelText('Python prefix')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Enter an absolute path.')).toBeTruthy()
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
  })
})

describe('ScienceSettingsCard: saved-restart-required', () => {
  it('shows the restart-required status distinct from the failure notice', () => {
    renderCard({ configured: true, restartRequired: true, pythonPrefix: field({ configured: true }) })
    expect(statusTexts()).toEqual(['Restart the Host to apply this change.'])
  })
})

describe('ScienceSettingsCard: reset-to-composition', () => {
  it('shows the remove-override action while overridden', () => {
    renderCard({ configured: true, overridden: true, pythonPrefix: field({ configured: true }) })
    expect(screen.getByRole('button', { name: 'Remove override' })).toBeTruthy()
  })

  it('hides the remove-override action once reset has revealed the composition base', () => {
    renderCard({ configured: true, overridden: false, pythonPrefix: field({ configured: true }) })
    expect(screen.queryByRole('button', { name: 'Remove override' })).toBeNull()
  })
})

describe('ScienceSettingsCard: accessible names', () => {
  it('gives every input a label-associated accessible name', () => {
    renderCard({})
    expect(screen.getByLabelText('Python prefix').tagName).toBe('INPUT')
    expect(screen.getByLabelText('R prefix').tagName).toBe('INPUT')
  })

  it('routes a keystroke in each input to the edit action for that field, and no other', () => {
    const { props } = renderCard({})
    fireEvent.change(screen.getByLabelText('R prefix'), { target: { value: SENTINEL } })
    expect(props.edit).toHaveBeenCalledTimes(1)
    expect(props.edit).toHaveBeenCalledWith('rPrefix', SENTINEL)
    fireEvent.change(screen.getByLabelText('Python prefix'), { target: { value: '/opt/conda/envs/science' } })
    expect(props.edit).toHaveBeenCalledTimes(2)
    expect(props.edit).toHaveBeenCalledWith('pythonPrefix', '/opt/conda/envs/science')
  })
})

describe('ScienceSettingsCard: end-to-end through the real controller', () => {
  it('a typed absolute path, saved, lands as restart-required through the real dispatch path', async () => {
    const stub = stubSettingsScope<ScienceRuntimeSettingsSection>()
    stub.setPath.mockImplementation((path: readonly string[]) => {
      stub.publish({ value: { science: {} }, secrets: [{ path: [...path], set: true }] })
    })
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish({ status: 'ready', writable: true, value: {}, base: undefined, user: undefined, secrets: [], revision: 1, mode: 'host' })

    const face = controller.inject()
    const buildProps = (): ScienceSettingsCardProps => ({
      t,
      useScienceSettingsCard: (sel: (s: ScienceSettingsCardState) => unknown) => sel(face.hooks.scienceSettingsCard.getSnapshot()),
      edit: face.edit,
      save: face.save,
      discard: face.discard,
      reset: face.reset,
    } as unknown as ScienceSettingsCardProps)

    const view = render(<ScienceSettingsCard {...buildProps()} />)
    fireEvent.click(toggle())
    fireEvent.change(screen.getByLabelText('Python prefix'), { target: { value: '/opt/conda/envs/science' } })
    view.rerender(<ScienceSettingsCard {...buildProps()} />)
    expect(screen.getByLabelText<HTMLInputElement>('Python prefix').value).toBe('/opt/conda/envs/science')

    await act(async () => { await controller.save() })
    view.rerender(<ScienceSettingsCard {...buildProps()} />)

    expect(statusTexts()).toEqual(['Restart the Host to apply this change.'])
    expect(screen.getByLabelText<HTMLInputElement>('Python prefix').value).toBe('')
    expect(screen.getByText('Configured')).toBeTruthy()
  })
})
