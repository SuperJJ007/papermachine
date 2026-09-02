import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { applicationMenuTemplate } from '../src/application-menu.ts'

function applicationItems(provisioning: boolean): readonly MenuItemConstructorOptions[] {
  const [application] = applicationMenuTemplate({
    appName: 'PaperMachine',
    provisioning,
    restartHost: vi.fn(),
    changeEnvironment: vi.fn(),
  })
  return application?.submenu as readonly MenuItemConstructorOptions[]
}

describe('applicationMenuTemplate', () => {
  it('places Restart Host above Change Environment and dispatches its action', () => {
    const restartHost = vi.fn()
    const [application] = applicationMenuTemplate({
      appName: 'PaperMachine',
      provisioning: false,
      restartHost,
      changeEnvironment: vi.fn(),
    })
    const items = application?.submenu as readonly MenuItemConstructorOptions[]

    expect(items.slice(0, 2).map(item => item.label)).toEqual(['Restart Host', 'Change Environment…'])
    items[0]?.click?.({} as never, {} as never, {} as never)
    expect(restartHost).toHaveBeenCalledOnce()
  })

  it('disables Restart Host only while provisioning is active', () => {
    expect(applicationItems(false)[0]?.enabled).toBe(true)
    expect(applicationItems(true)[0]?.enabled).toBe(false)
  })
})
