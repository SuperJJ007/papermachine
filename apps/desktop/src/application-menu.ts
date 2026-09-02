import type { MenuItemConstructorOptions } from 'electron'

/** Actions and state consumed by the desktop application menu. */
export interface ApplicationMenuOptions {
  /** The product name shown by macOS for the application submenu. */
  readonly appName: string
  /** Whether environment provisioning currently owns the desktop workflow. */
  readonly provisioning: boolean
  /** Restart the active Host process. */
  readonly restartHost: () => void
  /** Open the environment onboarding surface. */
  readonly changeEnvironment: () => void
}

/**
 * Build the Electron application-menu template from current workflow state.
 * @param options - Product label, provisioning state, and menu actions.
 * @returns A complete macOS application-menu template.
 */
export function applicationMenuTemplate(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  return [
    {
      label: options.appName,
      submenu: [
        {
          id: 'restart-host',
          label: 'Restart Host',
          accelerator: 'CommandOrControl+Shift+R',
          enabled: !options.provisioning,
          click: options.restartHost,
        },
        {
          label: 'Change Environment…',
          click: options.changeEnvironment,
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]
}
