/**
 * The Science settings card controller: presence read from the scope's own
 * `secrets` snapshot field, path-addressed writes fenced through the bound
 * scope, and the reachable card states (loading, unconfigured, configured,
 * saving, a Host-rejected write recovering to unconfigured/still-configured,
 * a client-blocked invalid draft, saved-restart-required, and
 * reset-to-composition).
 */
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  SCIENCE_RUNTIME_NS, ScienceSettingsCardController, type ScienceRuntimeSettingsSection,
} from '../src/client/settings-card-controller.ts'

/** A sentinel absolute path standing in for a real Conda prefix: it must never surface anywhere. */
const SENTINEL = '/sentinel-9f3a1c/should-never-be-echoed'

// The stub's `publish` member is method-shorthand-declared, so it is always
// called on the returned handle (`stub.publish(...)`), never destructured —
// destructuring a method-shorthand member is a real unbound-method footgun
// the lint rule catches regardless of this particular implementation.
function host() {
  return stubSettingsScope<ScienceRuntimeSettingsSection>()
}

/** A served, accepted section — the baseline every test layers over. */
function ready(over: Partial<SettingsScopeSnapshot<ScienceRuntimeSettingsSection>> = {}) {
  return {
    status: 'ready' as const, writable: true, value: {}, base: undefined, user: undefined, secrets: [], revision: 1, mode: 'host' as const, ...over,
  }
}

describe('SCIENCE_RUNTIME_NS', () => {
  it('names the R6a with-settings namespace', () => {
    expect(SCIENCE_RUNTIME_NS).toBe('science-runtime')
  })
})

describe('ScienceSettingsCardController', () => {
  it('starts loading before the first accepted section', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    const state = controller.inject().hooks.scienceSettingsCard.getSnapshot()
    expect(state).toMatchObject({ loading: true, configured: false, saving: false, restartRequired: false })
  })

  it('reports unconfigured when the profile is absent from the resolved section', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({ value: {} }))
    const state = controller.inject().hooks.scienceSettingsCard.getSnapshot()
    expect(state).toMatchObject({ loading: false, configured: false, overridden: false })
    expect(state.pythonPrefix).toEqual({ text: '', configured: false, invalid: false })
    expect(state.rPrefix).toEqual({ text: '', configured: false, invalid: false })
  })

  it('reports configured with per-field presence from the snapshot secrets list, and never echoes a stored value', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({
      value: { science: {} },
      user: { science: {} },
      secrets: [{ path: ['science', 'pythonPrefix'], set: true }, { path: ['science', 'rPrefix'], set: false }],
    }))
    const state = controller.inject().hooks.scienceSettingsCard.getSnapshot()
    expect(state.configured).toBe(true)
    expect(state.overridden).toBe(true)
    expect(state.pythonPrefix).toEqual({ text: '', configured: true, invalid: false })
    expect(state.rPrefix).toEqual({ text: '', configured: false, invalid: false })
  })

  it('matches secret presence on the full path, not a suffix or a differently-shaped path', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({
      secrets: [
        // Wrong profile id, wrong field name, and a too-short/too-long path: none of these mark pythonPrefix set.
        { path: ['other', 'pythonPrefix'], set: true },
        { path: ['science', 'other'], set: true },
        { path: ['science'], set: true },
        { path: ['science', 'pythonPrefix', 'extra'], set: true },
      ],
    }))
    const state = controller.inject().hooks.scienceSettingsCard.getSnapshot()
    expect(state.pythonPrefix.configured).toBe(false)
    expect(state.rPrefix.configured).toBe(false)
  })

  it('stages draft text per field, independent of the other field', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    const face = controller.inject()
    face.edit('pythonPrefix', SENTINEL)
    const state = face.hooks.scienceSettingsCard.getSnapshot()
    expect(state.pythonPrefix.text).toBe(SENTINEL)
    expect(state.rPrefix.text).toBe('')
    expect(state.dirty).toBe(true)
  })

  it('treats a blank staged draft as clean and not dirty', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    const face = controller.inject()
    face.edit('pythonPrefix', '   ')
    expect(face.hooks.scienceSettingsCard.getSnapshot().dirty).toBe(false)
  })

  it('flags a non-absolute draft as invalid and blocks it from the dirty write plan', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    const face = controller.inject()
    face.edit('pythonPrefix', 'relative/conda')
    const state = face.hooks.scienceSettingsCard.getSnapshot()
    expect(state.pythonPrefix.invalid).toBe(true)
    expect(state.invalid).toBe(true)
  })

  it('accepts POSIX, Windows-drive, and UNC absolute forms as valid drafts', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    const face = controller.inject()
    for (const draft of ['/opt/conda/envs/science', 'C:\\conda\\envs\\science', '\\\\host\\share\\conda']) {
      face.edit('pythonPrefix', draft)
      expect(face.hooks.scienceSettingsCard.getSnapshot().pythonPrefix.invalid).toBe(false)
    }
  })

  it('discard drops every staged draft and clears a stale failure', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    const face = controller.inject()
    face.edit('pythonPrefix', SENTINEL)
    face.discard()
    const state = face.hooks.scienceSettingsCard.getSnapshot()
    expect(state.pythonPrefix.text).toBe('')
    expect(state.dirty).toBe(false)
  })

  it('discard is a no-op when nothing is staged and nothing has failed', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    const face = controller.inject()
    const before = face.hooks.scienceSettingsCard.getSnapshot()
    face.discard()
    expect(face.hooks.scienceSettingsCard.getSnapshot()).toBe(before)
  })

  it('save writes only the dirty field at [profileId, field], never at the section root or a bare profile path', async () => {
    const stub = host()
    stub.setPath.mockImplementation((path: readonly string[]) => {
      const current = stub.scope.getSnapshot()
      const field = path[1] as 'pythonPrefix' | 'rPrefix'
      stub.publish({
        value: { ...current.value, science: {} },
        user: { ...(current.user as object | undefined), science: {} },
        secrets: [
          ...current.secrets.filter(s => !(s.path[0] === 'science' && s.path[1] === field)),
          { path: ['science', field], set: true },
        ],
      })
    })
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    controller.inject().edit('pythonPrefix', '/opt/conda/envs/science')
    await controller.save()

    expect(stub.setPath).toHaveBeenCalledTimes(1)
    expect(stub.setPath.mock.calls).toEqual([[['science', 'pythonPrefix'], '/opt/conda/envs/science']])
    for (const [path] of stub.setPath.mock.calls as [readonly string[], unknown][]) {
      expect(path).not.toEqual([])
      expect(path).not.toEqual(['profiles'])
      expect(path[0]).not.toBe('profiles')
    }
  })

  it('save writes each dirty field once when both are staged', async () => {
    const stub = host()
    stub.setPath.mockImplementation((path: readonly string[]) => {
      const field = path[1] as 'pythonPrefix' | 'rPrefix'
      const current = stub.scope.getSnapshot()
      stub.publish({ secrets: [...current.secrets, { path: ['science', field], set: true }] })
    })
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    const face = controller.inject()
    face.edit('pythonPrefix', '/opt/conda/envs/science')
    face.edit('rPrefix', '/opt/conda/envs/science-r')
    await controller.save()

    expect(stub.setPath.mock.calls).toEqual([
      [['science', 'pythonPrefix'], '/opt/conda/envs/science'],
      [['science', 'rPrefix'], '/opt/conda/envs/science-r'],
    ])
  })

  it('save is a no-op with nothing dirty or an invalid draft, and never reaches the wire', async () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())

    await controller.save()
    expect(stub.setPath).not.toHaveBeenCalled()

    controller.inject().edit('pythonPrefix', 'relative')
    await controller.save()
    expect(stub.setPath).not.toHaveBeenCalled()
  })

  it('a second save while one is already in flight does not reach the wire again', () => {
    const stub = host()
    stub.setPath.mockReturnValue(new Promise(() => {}))
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    controller.inject().edit('pythonPrefix', '/opt/conda/envs/science')
    void controller.save()
    expect(controller.inject().hooks.scienceSettingsCard.getSnapshot().saving).toBe(true)
    void controller.save()
    expect(stub.setPath).toHaveBeenCalledTimes(1)
  })

  it('the inject() face save action is a fire-and-forget wrapper over the async save', () => {
    const stub = host()
    stub.setPath.mockReturnValue(new Promise(() => {}))
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    const face = controller.inject()
    face.edit('pythonPrefix', '/opt/conda/envs/science')
    face.save()
    expect(stub.setPath).toHaveBeenCalledTimes(1)
    expect(face.hooks.scienceSettingsCard.getSnapshot().saving).toBe(true)
  })

  it('landed save (republished secret presence confirms it) clears drafts and marks restart-required', async () => {
    const stub = host()
    stub.setPath.mockImplementation((path: readonly string[]) => {
      const field = path[1] as 'pythonPrefix' | 'rPrefix'
      const current = stub.scope.getSnapshot()
      stub.publish({ value: { ...current.value, science: {} }, secrets: [{ path: ['science', field], set: true }] })
    })
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    controller.inject().edit('pythonPrefix', '/opt/conda/envs/science')
    await controller.save()

    const state = controller.inject().hooks.scienceSettingsCard.getSnapshot()
    expect(state.saving).toBe(false)
    expect(state.failed).toBe(false)
    expect(state.restartRequired).toBe(true)
    expect(state.pythonPrefix.text).toBe('')
  })

  it("a rejected write (stale revision or Host validation) recovers from the scope's own read-back and reports failed, preserving the draft", async () => {
    const stub = host()
    // The scope's own recovery read republishes UNCHANGED presence, exactly
    // like a real stale-write or validation recovery that finds no accepted
    // change — both causes are indistinguishable from this controller.
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({ secrets: [{ path: ['science', 'pythonPrefix'], set: false }] }))
    controller.inject().edit('pythonPrefix', SENTINEL)
    await controller.save()

    const state = controller.inject().hooks.scienceSettingsCard.getSnapshot()
    expect(state.saving).toBe(false)
    expect(state.failed).toBe(true)
    expect(state.restartRequired).toBe(false)
    expect(state.pythonPrefix.text).toBe(SENTINEL)
  })

  it('a later edit clears a stale failed flag', async () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready())
    controller.inject().edit('pythonPrefix', SENTINEL)
    await controller.save()
    expect(controller.inject().hooks.scienceSettingsCard.getSnapshot().failed).toBe(true)

    controller.inject().edit('rPrefix', '/opt/conda/envs/science-r')
    expect(controller.inject().hooks.scienceSettingsCard.getSnapshot().failed).toBe(false)
  })

  it('reset is a no-op while nothing is overridden', async () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({ user: undefined }))
    await controller.resetProfile()
    expect(stub.unsetPath).not.toHaveBeenCalled()
  })

  it('reset unsets only the profile path, revealing the composition base (reset-to-composition)', async () => {
    const stub = host()
    stub.unsetPath.mockImplementation(() => { stub.publish({ user: undefined }) })
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({
      value: { science: {} },
      base: { science: {} },
      user: { science: {} },
      secrets: [{ path: ['science', 'pythonPrefix'], set: true }],
    }))
    await controller.resetProfile()

    expect(stub.unsetPath).toHaveBeenCalledTimes(1)
    expect(stub.unsetPath.mock.calls).toEqual([[['science']]])
    const state = controller.inject().hooks.scienceSettingsCard.getSnapshot()
    expect(state.overridden).toBe(false)
    expect(state.configured).toBe(true) // the composition base still names the profile
    expect(state.restartRequired).toBe(true)
  })

  it('a reset the Host refuses stays overridden and reports failed', async () => {
    const stub = host() // unsetPath default: resolves without publishing — models a refusal
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({ value: { science: {} }, user: { science: {} }, secrets: [{ path: ['science', 'pythonPrefix'], set: true }] }))
    await controller.resetProfile()
    const state = controller.inject().hooks.scienceSettingsCard.getSnapshot()
    expect(state.failed).toBe(true)
    expect(state.overridden).toBe(true)
  })

  it('the inject() face reset action is a fire-and-forget wrapper over the async resetProfile', () => {
    const stub = host()
    stub.unsetPath.mockReturnValue(new Promise(() => {}))
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({ user: { science: {} } }))
    controller.inject().reset()
    expect(stub.unsetPath).toHaveBeenCalledTimes(1)
    expect(controller.inject().hooks.scienceSettingsCard.getSnapshot().saving).toBe(true)
  })

  it('a second reset while one is already in flight does not reach the wire again', () => {
    const stub = host()
    stub.unsetPath.mockReturnValue(new Promise(() => {}))
    const controller = new ScienceSettingsCardController(stub.scope)
    stub.publish(ready({ user: { science: {} } }))
    void controller.resetProfile()
    void controller.resetProfile()
    expect(stub.unsetPath).toHaveBeenCalledTimes(1)
  })

  it('republishes on every scope change, including one this controller did not initiate', () => {
    const stub = host()
    const controller = new ScienceSettingsCardController(stub.scope)
    const store = controller.inject().hooks.scienceSettingsCard
    const seen: boolean[] = [store.getSnapshot().loading]
    store.subscribe(() => { seen.push(store.getSnapshot().loading) })
    stub.publish(ready())
    expect(seen).toEqual([true, false])
  })
})
