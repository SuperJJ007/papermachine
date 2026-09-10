/** Typed English and Chinese copy owned by the Electron shell. */

export const en = {
  application: 'Application',
  copyDiagnostics: 'Copy diagnostics',
  diagnosticsCopied: 'Diagnostics copied.',
  diagnosticsCopyFailed: 'Could not copy diagnostics: {error}',
  homeUnresolved: 'Home could not be resolved',
  resetHome: 'Use default install location',
  resetHomeDetail: 'Restart using ~/.papermachine. Existing files remain in their current locations.',
  homeChangeDetail: 'Install at {path}. Existing data is not moved. The application runtime and environment must be installed again.',
  homeNonAscii: 'This path contains non-ASCII characters. Some scientific packages may not support it.',
  homeSpaceError: 'R requires an install path without spaces.',
  confirm: 'Confirm',
  restart: 'Restart',
  quit: 'Quit',

  packageSummary: '{count} packages · {megabytes} MB download',
  setupDescription: 'Set up your scientific environment.',
  chooseHome: 'Change install location…',
  packageSource: 'Package source',
  customPackages: 'Customize packages',
  useCustomPackages: 'Install the edited package list',
  setupConfirmation: 'Install downloads the application runtime and the selected environment. You can cancel the environment download.',
  installEnvironment: 'Install environment',
  keepEnvironment: 'Open current environment',
  cancel: 'Cancel',
  packagesLabel: 'packages',
  setupRuntime: 'Preparing application runtime…',
  changeEnvironment: 'Change environment…',

  startupFailed: 'PaperMachine could not start',
  pluginsMenu: 'Desktop Plugins…',
  pluginsMenuPackagedOnly: 'Desktop Plugins… (available in packaged applications)',
  checkUpdatesMenu: 'Check for Updates…',
  updateCheckFailedTitle: 'Update Check Failed',
  unknownError: 'Unknown error',
  updateCheckTitle: 'Check for Updates',
  updateCurrent: 'You already have the latest version.',
  updateTitle: 'PaperMachine Update',
  updateAvailable: 'An update is available',
  updateDetail: 'PaperMachine {version}\n\nThis release includes its matching dsh version. The application will restart after installation.',
  installAndRestart: 'Install and Restart',
  later: 'Later',
  updateFailedTitle: 'Update Failed',
  pluginManagerTitle: 'Desktop Plugins',
  pluginWindowTitle: 'PaperMachine — Desktop Plugins',
  pluginManagerDescription: 'Plugins are installed only in the Desktop node_modules and are managed by the bundled pnpm.',
  refresh: 'Refresh',
  npmPackage: 'npm package',
  install: 'Install',
  installed: 'Installed',
  noPlugins: 'No Desktop plugins are installed.',
  remove: 'Remove',
  update: 'Update',
  targetVersion: 'Enter the target version for {name}',
  removing: 'Removing {name}…',
  updating: 'Updating {name}…',
  installing: 'Installing {spec}…',
  operationComplete: 'Done. The Desktop backend has restarted.',
  refreshing: 'Refreshing…',
  refreshed: 'Plugin list refreshed.',
  loadingPlugins: 'Reading Desktop plugins…',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  application: '应用',
  copyDiagnostics: '复制诊断信息',
  diagnosticsCopied: '诊断信息已复制。',
  diagnosticsCopyFailed: '无法复制诊断信息：{error}',
  homeUnresolved: '主目录未能解析',
  resetHome: '使用默认安装位置',
  resetHomeDetail: '重启后使用 ~/.papermachine，现有文件保留在原位置。',
  homeChangeDetail: '安装到 {path}。现有数据不移动，需重新安装应用运行时和环境。',
  homeNonAscii: '路径含非 ASCII 字符，部分科学软件包可能无法使用。',
  homeSpaceError: 'R 需要不含空格的安装路径。',
  confirm: '确认',
  restart: '重启',
  quit: '退出',

  packageSummary: '{count} 个软件包 · 下载 {megabytes} MB',
  setupDescription: '设置科学计算环境。',
  chooseHome: '更改安装位置…',
  packageSource: '软件包来源',
  customPackages: '自定义软件包',
  useCustomPackages: '安装编辑后的软件包清单',
  setupConfirmation: '安装将下载应用运行时和所选环境，可取消环境下载。',
  installEnvironment: '安装环境',
  keepEnvironment: '打开当前环境',
  cancel: '取消',
  packagesLabel: '个软件包',
  setupRuntime: '正在准备应用运行时…',
  changeEnvironment: '更改环境…',

  startupFailed: 'PaperMachine 无法启动',
  pluginsMenu: '桌面插件…',
  pluginsMenuPackagedOnly: '桌面插件…（打包应用中可用）',
  checkUpdatesMenu: '检查更新…',
  updateCheckFailedTitle: '更新检查失败',
  unknownError: '未知错误',
  updateCheckTitle: '检查更新',
  updateCurrent: '当前已是最新版本。',
  updateTitle: 'PaperMachine 更新',
  updateAvailable: '发现可用更新',
  updateDetail: 'PaperMachine {version}\n\n新版本绑定匹配的 dsh，安装后将重新启动。',
  installAndRestart: '安装并重启',
  later: '稍后',
  updateFailedTitle: '更新失败',
  pluginManagerTitle: '桌面插件',
  pluginWindowTitle: 'PaperMachine — 桌面插件',
  pluginManagerDescription: '插件只安装到桌面端自己的 node_modules，并由内置 pnpm 管理。',
  refresh: '刷新',
  npmPackage: 'npm 包',
  install: '安装',
  installed: '已安装',
  noPlugins: '还没有安装桌面插件。',
  remove: '移除',
  update: '更新',
  targetVersion: '输入 {name} 的目标版本',
  removing: '正在移除 {name}…',
  updating: '正在更新 {name}…',
  installing: '正在安装 {spec}…',
  operationComplete: '操作完成，桌面后端已重新启动。',
  refreshing: '正在刷新…',
  refreshed: '插件列表已刷新。',
  loadingPlugins: '正在读取桌面插件…',
} as const satisfies DesktopMessages

/** Locale payload exposed to the Desktop-owned renderer. */
export interface DesktopLocale {
  readonly id: 'en' | 'zh-CN'
  readonly messages: DesktopMessages
}

/** Resolve Electron's locale to one shipped Desktop dictionary. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  return locale.toLowerCase().startsWith('zh')
    ? { id: 'zh-CN', messages: zh }
    : { id: 'en', messages: en }
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => values[key] ?? placeholder)
}
