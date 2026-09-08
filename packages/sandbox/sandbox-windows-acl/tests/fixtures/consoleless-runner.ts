/** Start the real ACL runner after detaching the test launcher's inherited console. */

import koffi from 'koffi'

const kernel32 = koffi.load('kernel32.dll')
const freeConsole = kernel32.func('int __stdcall FreeConsole()')
const getConsoleWindow = kernel32.func('void* __stdcall GetConsoleWindow()')
if (getConsoleWindow() && freeConsole() === 0) throw new Error('consoleless fixture could not detach its console')
if (getConsoleWindow()) throw new Error('consoleless fixture still owns a console')
await import('../../src/runner.ts')
