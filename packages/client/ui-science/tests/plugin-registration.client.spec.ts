// @vitest-environment jsdom
/** Public Science composition, lifecycle, and session-owned commands. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ComposerSubmission, ComposerSubmissionHandler } from '@deepseek-ai/dsh-client-ui-conversation/src/client/service.ts'
import type { ScienceEditSelection } from '@deepseek-ai/dsh-tool-science/types'
import { apply, inject } from '../src/client/index.ts'
import type { ScienceDetailsInjected } from '../src/client/ScienceDetailsView.tsx'
import { ScienceDetailsView } from '../src/client/ScienceDetailsView.tsx'
import { ScienceLibrary } from '../src/client/ScienceLibrary.tsx'
import { ScienceTraceView } from '../src/client/ScienceTraceView.tsx'
import { ScienceTurnArtifacts } from '../src/client/ScienceTurnArtifacts.tsx'
import { ScienceExecutionRow } from '../src/client/ScienceExecutionRow.tsx'
import { ScienceAnnotationRow } from '../src/client/ScienceAnnotationRow.tsx'
import { ScienceOutcomeRow } from '../src/client/ScienceOutcomeRow.tsx'

const SID = 's1' as SessionId
const SECOND = 's2' as SessionId
const target: ScienceEditSelection = {
  artifactId: 'chart-1' as ScienceEditSelection['artifactId'], logicalName: 'chart.png', version: 2,
  target: { kind: 'normalized-region', x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
}
const disposers: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose() })

async function setup() {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  slots.register({ name: 'root', children: {
    'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    'conversation.chat.turnTail': { kind: 'chain', scope: 'session' },
    'conversation.view': { kind: 'list', scope: 'session' },
    'settings.plugin.item': { kind: 'keyed', scope: 'root' },
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    'conversation.input.dock': { kind: 'list', scope: 'session' },
    'conversation.composer.dock': { kind: 'list', scope: 'session' },
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
    'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
    'sidebar.right.tab.guide': { kind: 'chain', scope: 'session' },
    'sidebar.right.tab.menu.item': { kind: 'list', scope: 'session' },
  } } as never, () => null)
  const releaseLocale = vi.fn()
  ctx.provide('locale', { subscribe: () => () => {}, register: vi.fn(() => releaseLocale), bind: () => (key: string) => key } as never)
  ctx.provide('connection', {} as never)
  ctx.provide('sessions', {} as never)
  const scienceEdits = {
    submit: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; value?: { accepted: boolean }; error?: { message: string } }>>()
      .mockResolvedValue({ ok: true, value: { accepted: true } }),
    addArtifactNote: vi.fn(), removeArtifactNote: vi.fn(), applyChartOps: vi.fn(), previewChartOps: vi.fn(), saveArtifactAs: vi.fn(),
  }
  const science = { scienceLibrary: vi.fn(), scienceChartState: vi.fn(), scienceVersions: vi.fn() }
  const cancel = vi.fn().mockResolvedValue({ ok: true })
  ctx.provide('remote', { science, scienceEdits, session: { cancel } } as never)
  ctx.provide('remote.science', science as never)
  ctx.provide('remote.scienceEdits', scienceEdits as never)
  const releaseHandler = vi.fn()
  const registerSubmissionHandler = vi.fn<(handler: ComposerSubmissionHandler) => () => void>(() => releaseHandler)
  const openView = vi.fn()
  ctx.provide('conversation', { registerSubmissionHandler, openView } as never)
  const registerEvents = vi.fn(() => () => {})
  ctx.provide('uiConversation', { events: { register: registerEvents } } as never)
  const openResourceIn = vi.fn()
  const openTabIn = vi.fn()
  ctx.provide('sidebarRight', { openResourceIn, openTabIn } as never)
  const releaseTab = vi.fn()
  const registerTab = vi.fn(() => releaseTab)
  ctx.provide('sidebarRightTabs', { register: registerTab } as never)
  const releaseResource = vi.fn()
  const registerResource = vi.fn(() => releaseResource)
  ctx.provide('resources', { register: registerResource } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  disposers.push(async () => { await fiber.dispose() })
  const details = (id: SessionId): ScienceDetailsInjected => {
    const entry = slots.entries('sidebar.right.pane.tab')[0]
    if (entry?.inject === undefined) throw new Error('artifact body missing')
    return (entry.inject as unknown as (id: SessionId) => ScienceDetailsInjected)(id)
  }
  const handler = registerSubmissionHandler.mock.calls[0]?.[0]
  if (handler === undefined) throw new Error('submission handler missing')
  return { slots, fiber, details, handler, science, scienceEdits, cancel, openView, openResourceIn, openTabIn,
    registerTab, registerResource, registerEvents, releaseLocale, releaseHandler, releaseTab, releaseResource }
}

function submission(sessionId = SID, attachments: ComposerSubmission['attachmentIds'] = []): ComposerSubmission {
  return { sessionId, attachmentIds: attachments, text: 'edit it', mode: 'queue', signal: undefined }
}

describe('ui-science public composition', () => {
  it('registers artifact body/title, guide, menu, independent Science view and standard tool rows', async () => {
    const b = await setup()
    expect(b.registerTab).toHaveBeenCalledWith(expect.objectContaining({ id: 'science-artifact', patterns: ['dsh-resource://science-artifact/*'] }))
    expect(b.registerResource).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'science-artifact' }))
    expect(b.slots.entries('sidebar.right.pane.tab')[0]?.component).toBe(ScienceDetailsView)
    expect(b.slots.entries('sidebar.right.pane.tab.title')).toHaveLength(2)
    expect(b.slots.entries('sidebar.right.tab.menu.item')).toHaveLength(1)
    expect(b.slots.entries('sidebar.right.tab.guide')[0]?.component).toBe(ScienceLibrary)
    expect(b.slots.entries('conversation.view')[0]?.component).toBe(ScienceTraceView)
    expect(b.slots.entries('conversation.view')[0]?.options.id).toBe('science')
    expect(b.slots.entries('conversation.chat.turnTail')[0]?.component).toBe(ScienceTurnArtifacts)
    const tools = new Map(b.slots.entries('tool.call.toolview').map(entry => [entry.options.key, entry.component]))
    expect(tools.get('run_python')).toBe(ScienceExecutionRow)
    expect(tools.get('run_r')).toBe(ScienceExecutionRow)
    expect(tools.get('annotate_artifact')).toBe(ScienceAnnotationRow)
    expect(tools.get('publish_outcome')).toBe(ScienceOutcomeRow)
    await b.fiber.dispose()
    expect(b.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
    for (const release of [b.releaseLocale, b.releaseHandler, b.releaseTab, b.releaseResource]) expect(release).toHaveBeenCalledTimes(1)
  })

  it('binds Remote reads and provenance commands to the artifact tab session', async () => {
    const b = await setup()
    b.science.scienceLibrary.mockResolvedValue({ ok: true, value: { artifacts: [] } })
    const face = b.details(SECOND)
    await face.loadLibrary()
    expect(b.science.scienceLibrary).toHaveBeenCalledWith(SECOND)
    face.inspectCall('call-2')
    face.returnToConversation('anchor-2')
    expect(b.openView.mock.calls).toEqual([[SECOND, 'trajectory', 'call-2'], [SECOND, 'chat', 'anchor-2']])
    expect(face).not.toHaveProperty('selectDetailed')
  })

  it('opens exact versions through the originating session and keeps versions out of resource identity', async () => {
    const b = await setup()
    const entry = b.slots.entries('conversation.chat.turnTail')[0]
    if (entry?.inject === undefined) throw new Error('turn tail missing')
    const face = (entry.inject as (id: SessionId) => { openArtifact: (value: { artifactId: string; version: number }) => void })(SECOND)
    face.openArtifact({ artifactId: 'chart/one', version: 3 })
    face.openArtifact({ artifactId: 'chart/one', version: 4 })
    expect(b.openResourceIn.mock.calls).toEqual([
      [SECOND, 'dsh-resource://science-artifact/chart%2Fone', { params: { version: 3 } }],
      [SECOND, 'dsh-resource://science-artifact/chart%2Fone', { params: { version: 4 } }],
    ])
  })

  it('declines unstaged submissions, isolates targets by session, and clears a successful edit', async () => {
    const b = await setup()
    expect(b.handler(submission())).toBeUndefined()
    const face = b.details(SID)
    face.addToConversation([target])
    expect(b.handler(submission(SECOND))).toBeUndefined()
    await expect(b.handler(submission(SID, ['image' as ComposerSubmission['attachmentIds'][number]]))).resolves.toMatchObject({ kind: 'error' })
    expect(b.scienceEdits.submit).not.toHaveBeenCalled()
    await expect(b.handler(submission())).resolves.toEqual({ kind: 'success' })
    expect(b.scienceEdits.submit).toHaveBeenCalledWith(SID, { targets: [target], instruction: 'edit it' })
    expect(face.hooks.composerSelections.getSnapshot()).toEqual([])
  })

  it('retains staged edits on host refusal or transport failure', async () => {
    const b = await setup()
    const face = b.details(SID)
    face.addToConversation([target])
    b.scienceEdits.submit.mockResolvedValueOnce({ ok: false, error: { message: 'rejected' } })
    await expect(b.handler(submission())).resolves.toEqual({ kind: 'error', text: 'rejected' })
    b.scienceEdits.submit.mockRejectedValueOnce(new Error('offline'))
    await expect(b.handler(submission())).rejects.toThrow('offline')
    expect(face.hooks.composerSelections.getSnapshot()).toEqual([target])
  })
})
