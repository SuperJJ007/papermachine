/**
 * Browser trajectory plugin contributing one entry to the conversation view
 * slot without defining a service.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createTrajectoryDurationStore } from './duration-store.ts'
import { en, NS, zh } from './locales.ts'
import { registerTrajectoryAssistantDefinition } from './trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from './trajectory-compaction-definition.ts'
import { registerTrajectoryMessageDefinitions } from './trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from './trajectory-request-header-definition.ts'
import { registerTrajectoryConversationView } from './trajectory-snapshot-builder.ts'
import { registerTrajectoryToolDefinition } from './trajectory-tool-definition.ts'
import { TrajectoryView, type TrajectoryViewInjected } from './TrajectoryView.tsx'
import { TrajectoryShell, type TrajectoryShellInjected } from './TrajectoryShell.tsx'
import { TrajectorySubviewRegistry } from './trajectory-subviews.ts'

export {
  TrajectorySubviewRegistry,
  type TrajectorySubviewEntry,
  type TrajectoryViewVisibilitySource,
} from './trajectory-subviews.ts'

/** Required services: the conversation slot, registries, ordinary Session paging, and the locale service. */
export const inject = ['slots', 'conversationEvents', 'conversationViews', 'sessions', 'locale']

/**
 * Client plugin body: register the trajectory view tab. The registration
 * rides the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-trajectory: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  const duration = createTrajectoryDurationStore()
  const subviews = new TrajectorySubviewRegistry()
  ctx.provide('trajectorySubviews', subviews)
  registerTrajectoryMessageDefinitions(ctx)
  registerTrajectoryRequestHeaderDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryCompactionDefinitions(ctx)
  registerTrajectoryConversationView(ctx)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'trajectory',
    order: 10,
    locale: NS,
    label: () => t('view.trajectory'),
    inject: (sessionId: SessionId): TrajectoryShellInjected => {
      let cachedVersion = ''
      let cachedViews: ReturnType<TrajectoryShellInjected['hooks']['views']['getSnapshot']> = []
      return {
        hooks: {
          views: {
            getSnapshot: () => {
              const version = `${ctx.slots.getVersion('trajectory.view')}:${subviews.version()}:${ctx.locale.getSnapshot().revision}`
              if (version === cachedVersion) return cachedViews
              cachedVersion = version
              cachedViews = ctx.slots.entries('trajectory.view')
                .filter(entry => entry.options.id !== undefined
                  && subviews.visible(sessionId, entry.options.id))
                .map(entry => ({
                  id: entry.options.id ?? '',
                  order: entry.options.order ?? 0,
                  label: typeof entry.options.label === 'function'
                    ? entry.options.label()
                    : entry.options.label ?? entry.options.id ?? '',
                }))
                .sort((left, right) => left.order - right.order)
              return cachedViews
            },
            subscribe: (listener) => {
              const disposeSlots = ctx.slots.subscribe('trajectory.view', listener)
              const disposeVisibility = subviews.subscribe(listener)
              const disposeLocale = ctx.locale.subscribe(listener)
              return () => { disposeSlots(); disposeVisibility(); disposeLocale() }
            },
          },
          selection: {
            getSnapshot: () => subviews.selection(sessionId),
            subscribe: listener => subviews.subscribe(listener),
          },
        },
        select: (id) => { subviews.select(sessionId, id) },
      }
    },
    children: { 'trajectory.view': { kind: 'list', scope: 'session' } },
  }, TrajectoryShell))
  ctx.slots.inject('trajectory.view', () => ctx.slots.register({
    name: 'trajectory.view',
    id: 'detailed',
    order: 10,
    locale: NS,
    label: () => t('view.detailed'),
    inject: (sessionId: SessionId): TrajectoryViewInjected => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) {
        throw new Error(`ui-trajectory: session "${sessionId}" is unavailable`)
      }
      return {
        hooks: { duration },
        loadOlder: async () => {
          const before = session.getSnapshot().views.get('trajectory')
          await session.loadOlder()
          return session.getSnapshot().views.get('trajectory') !== before
        },
        setActualDuration: (value) => { duration.set(value) },
      }
    },
  }, TrajectoryView))
}
