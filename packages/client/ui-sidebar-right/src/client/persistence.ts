/** Validated browser preferences; layout undo history belongs to the live page. */
import { EMPTY_HISTORY, type LayoutState } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SidebarRightState, SurfaceState } from './stores.ts'

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Sidebar preferences object')
  return value as Record<string, unknown>
}

function requirePreference(condition: boolean): asserts condition {
  if (!condition) throw new Error('Invalid Sidebar layout preferences')
}

function strings(value: unknown): string[] {
  requirePreference(Array.isArray(value) && value.every(item => typeof item === 'string'))
  return value
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readSurface(value: unknown): SurfaceState {
  const surface = object(value)
  const layout = object(surface.layout)
  const nodes = object(layout.nodes)
  const tabs = object(layout.tabs)
  const minted = surface.minted
  requirePreference(typeof minted === 'number' && Number.isSafeInteger(minted) && minted >= 1 && minted < Number.MAX_SAFE_INTEGER)
  const id = (value: unknown, prefixes: string): string => {
    requirePreference(typeof value === 'string')
    const match = new RegExp(`^(?:${prefixes})([1-9][0-9]*)$`, 'u').exec(value)
    requirePreference(match !== null && Number(match[1]) <= minted)
    return value
  }
  const root = id(layout.rootId, 'pane|split')
  const active = id(layout.activePaneId, 'pane|float')
  requirePreference(typeof layout.expanded === 'boolean' && (layout.mode === 'push' || layout.mode === 'fullscreen'))
  const floats = strings(layout.floats)
  const reached = new Set<string>()
  const ownedTabs = new Set<string>()
  const pending: Array<{ key: string; host: 'dock' | 'float' }> = [
    { key: root, host: 'dock' }, ...floats.map(key => ({ key, host: 'float' as const })),
  ]
  for (const { key, host } of pending) {
    requirePreference(!reached.has(key) && Object.hasOwn(nodes, key))
    reached.add(key)
    const node = object(nodes[key])
    requirePreference(node.id === key)
    if (node.kind === 'split') {
      id(key, 'split')
      requirePreference(host === 'dock' && (node.axis === 'row' || node.axis === 'column'))
      const children = strings(node.children)
      const sizes = node.sizes
      requirePreference(children.length >= 2 && Array.isArray(sizes) && sizes.length === children.length
        && sizes.every(size => finite(size) && size > 0))
      requirePreference(Math.abs((sizes as number[]).reduce((sum, size) => sum + size, 0) - 1) < 1e-9)
      pending.push(...children.map(child => ({ key: child, host: 'dock' as const })))
    } else {
      id(key, host === 'dock' ? 'pane' : 'float')
      requirePreference(node.kind === 'pane' && node.host === host)
      const tabIds = strings(node.tabs)
      requirePreference(tabIds.length === 0 ? node.activeTabId === undefined : tabIds.includes(node.activeTabId as string))
      if (host === 'float') {
        const rect = object(node.rect)
        requirePreference(tabIds.length === 1 && finite(rect.x) && finite(rect.y)
          && finite(rect.width) && rect.width > 0 && finite(rect.height) && rect.height > 0)
      } else {
        requirePreference(node.rect === undefined)
      }
      for (const tabId of tabIds) {
        id(tabId, 'tab')
        requirePreference(!ownedTabs.has(tabId) && Object.hasOwn(tabs, tabId))
        ownedTabs.add(tabId)
        const tab = object(tabs[tabId])
        requirePreference(tab.id === tabId && typeof tab.kind === 'string' && tab.kind.length > 0
          && typeof tab.contentId === 'string' && tab.contentId.length > 0 && typeof tab.title === 'string')
      }
    }
  }
  requirePreference(reached.size === Object.keys(nodes).length && ownedTabs.size === Object.keys(tabs).length
    && reached.has(active) && object(nodes[active]).kind === 'pane')
  // The JSON parser and graph checks above establish the DockKit record types.
  return { layout: layout as unknown as LayoutState, minted, history: EMPTY_HISTORY }
}

/**
 * Project only the current layout and its identity counter into browser storage.
 * @param state - Live Sidebar state.
 * @returns Per-session preferences without undo operations.
 */
export function saveSidebarPreferences(state: SidebarRightState): unknown {
  return { bySession: Object.fromEntries(Object.entries(state.bySession).map(([key, surface]) =>
    [key, { layout: surface.layout, minted: surface.minted }])) }
}

/**
 * Restore valid layouts with fresh undo histories; malformed JSON is rejected atomically.
 * @param saved - Parsed browser preferences.
 * @returns Validated Sidebar state.
 */
export function restoreSidebarPreferences(saved: unknown): SidebarRightState {
  return { bySession: Object.fromEntries(Object.entries(object(object(saved).bySession)).map(([key, value]) =>
    [key, readSurface(value)])) }
}
