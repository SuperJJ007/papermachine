/** Console ownership for a GUI-hosted ACL runner and its restricted descendants. */

import { isInvalidHandle, isNullPtr, throwLastError } from './ffi.ts'
import type { Win32Bindings } from './ffi.ts'
import { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE } from './win32-abi.ts'

/**
 * Give a consoleless runner a hidden console before it creates restricted children.
 * Existing CLI or pseudoconsole ownership is preserved. The runner process owns
 * an allocated console until exit; its original pipe/NUL handles remain the
 * child's standard streams. A restricted descendant cannot allocate this console
 * itself, including a launcher that creates another console-subsystem process.
 * @param api - native console and error functions.
 */
export function ensureRunnerConsole(api: Win32Bindings): void {
  if (!isNullPtr(api.getConsoleWindow())) return
  const handles = [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE].map((which) => {
    const handle = api.getStdHandle(which)
    if (isInvalidHandle(handle)) throw new Error('ACL runner requires valid inherited standard handles')
    return { which, handle }
  })
  if (api.allocConsole() === 0) throwLastError(api, 'AllocConsole')
  const window = api.getConsoleWindow()
  if (isNullPtr(window)) throw new Error('AllocConsole succeeded without an associated console window')
  // ShowWindow returns the previous visibility, not a success flag.
  api.showWindow(window, 0)
  for (const { which, handle } of handles) {
    if (api.setStdHandle(which, handle) === 0) throwLastError(api, 'SetStdHandle')
  }
}
