import { describe, expect, it } from 'vitest'
import { DesktopOperation } from '../src/desktop-operation.ts'

describe('desktop operation ownership', () => {
  it('rejects concurrent package and environment mutations before either starts', async () => {
    const operation = new DesktopOperation()
    const pending = Promise.withResolvers<undefined>()
    const first = operation.run(() => pending.promise)
    await expect(operation.run(async () => {})).rejects.toThrow('another operation')
    pending.resolve(undefined)
    await first
    await operation.run(async () => {})
    expect(operation.busy).toBe(false)
  })
  it('aborts and waits for provisioning before refusing future work', async () => {
    const operation = new DesktopOperation()
    const pending = Promise.withResolvers<undefined>()
    let signal: AbortSignal | undefined
    const run = operation.run((value) => { signal = value; return pending.promise })
    await Promise.resolve()
    let stopped = false
    const shutdown = operation.shutdown().then(() => { stopped = true })
    expect(signal?.aborted).toBe(true)
    await Promise.resolve()
    expect(stopped).toBe(false)
    pending.resolve(undefined)
    await run
    await shutdown
    await expect(operation.run(async () => {})).rejects.toThrow('quitting')
  })
  it('releases ownership after a failed installation', async () => {
    const operation = new DesktopOperation()
    await expect(operation.run(async () => { throw new Error('failed solve') })).rejects.toThrow('failed solve')
    await expect(operation.run(async () => 'retry')).resolves.toBe('retry')
  })
})
