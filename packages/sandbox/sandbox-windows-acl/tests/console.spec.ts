/** GUI runner console ownership and preservation of inherited streams. */

import { describe, expect, it, vi } from 'vitest'
import { ensureRunnerConsole } from '../src/console.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
const STD_INPUT_HANDLE = -10
const STD_OUTPUT_HANDLE = -11
const STD_ERROR_HANDLE = -12

function consoleApi() {
  const window = 100n as NativePtr
  const api = {
    getConsoleWindow: vi.fn<Win32Bindings['getConsoleWindow']>().mockReturnValue(window),
    getConsoleCP: vi.fn(() => 65001).mockReturnValueOnce(0),
    allocConsole: vi.fn(() => 1),
    showWindow: vi.fn(() => 0),
    getStdHandle: vi.fn((which: number) => BigInt(-which) as NativePtr),
    setStdHandle: vi.fn(() => 1),
    getLastError: vi.fn(() => 5),
    formatMessageW: vi.fn(() => 0),
  }
  // Only the console and error calls are reached by this native API fixture.
  return { api, bindings: api as unknown as Win32Bindings, window }
}

describe('ensureRunnerConsole', () => {
  it('preserves an existing console without changing its window or standard handles', () => {
    const { api, bindings, window } = consoleApi()
    api.getConsoleWindow.mockReset().mockReturnValue(window)
    api.getConsoleCP.mockReset().mockReturnValue(65001)
    ensureRunnerConsole(bindings)
    expect(api.allocConsole).not.toHaveBeenCalled()
    expect(api.showWindow).not.toHaveBeenCalled()
    expect(api.getStdHandle).not.toHaveBeenCalled()
  })

  it('allocates and hides its own console while restoring all three inherited handles', () => {
    const { api, bindings, window } = consoleApi()
    ensureRunnerConsole(bindings)
    expect(api.allocConsole).toHaveBeenCalledOnce()
    expect(api.showWindow).toHaveBeenCalledWith(window, 0)
    expect(api.setStdHandle.mock.calls).toEqual(
      [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE].map(which => [which, BigInt(-which)]),
    )
    expect(api.getStdHandle.mock.invocationCallOrder.at(-1)).toBeLessThan(api.allocConsole.mock.invocationCallOrder[0]!)
    expect(api.allocConsole.mock.invocationCallOrder[0]).toBeLessThan(api.setStdHandle.mock.invocationCallOrder[0]!)
  })

  it('rejects an invalid inherited handle before allocating a console', () => {
    const { api, bindings } = consoleApi()
    api.getStdHandle.mockReturnValue(-1n as NativePtr)
    expect(() => { ensureRunnerConsole(bindings) }).toThrow('valid inherited standard handles')
    expect(api.allocConsole).not.toHaveBeenCalled()
  })

  it('reports native allocation failure without changing standard handles', () => {
    const { api, bindings } = consoleApi()
    api.allocConsole.mockReturnValue(0)
    expect(() => { ensureRunnerConsole(bindings) }).toThrow('AllocConsole')
    expect(api.setStdHandle).not.toHaveBeenCalled()
  })

  it('rejects an allocation that did not establish console ownership', () => {
    const { api, bindings } = consoleApi()
    api.getConsoleCP.mockReset().mockReturnValue(0)
    expect(() => { ensureRunnerConsole(bindings) }).toThrow('without an associated console')
    expect(api.setStdHandle).not.toHaveBeenCalled()
  })

  it('reports failure to restore an inherited handle', () => {
    const { api, bindings } = consoleApi()
    api.setStdHandle.mockReturnValue(0)
    expect(() => { ensureRunnerConsole(bindings) }).toThrow('SetStdHandle')
  })

  it('preserves attachment to an existing windowless console', () => {
    const { api, bindings } = consoleApi()
    api.getConsoleWindow.mockReturnValue(null)
    api.getConsoleCP.mockReset().mockReturnValue(65001)
    ensureRunnerConsole(bindings)
    expect(api.allocConsole).not.toHaveBeenCalled()
    expect(api.setStdHandle).not.toHaveBeenCalled()
  })

  it('restores standard handles when a newly allocated console has no window', () => {
    const { api, bindings } = consoleApi()
    api.getConsoleWindow.mockReturnValue(null)
    ensureRunnerConsole(bindings)
    expect(api.showWindow).not.toHaveBeenCalled()
    expect(api.setStdHandle).toHaveBeenCalledTimes(3)
  })
})
