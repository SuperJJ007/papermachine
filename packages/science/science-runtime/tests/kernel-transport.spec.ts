/**
 * `LoopbackTcpTransport` against a real `node:net` client in-process: token
 * handshake, second-connection refusal, EOF classification parity with the
 * FIFO path, and teardown releasing the listening port. The FIFO transport
 * itself is exercised end-to-end through `kernel-process.spec.ts`; this file
 * covers only the win32 transport's own carrier mechanics.
 */

import { Server, connect } from 'node:net'
import type { Socket } from 'node:net'
import { setTimeout as sleepMs } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { LoopbackTcpTransport, selectKernelTransportKind } from '../src/kernel-transport.ts'

/** A subprocess handle whose `done` never settles: the transport's connect() races it against a real exit only. */
function neverExitingHandle(): SubprocessHandle {
  return { done: new Promise(() => {}) } as unknown as SubprocessHandle
}

/** Parse `tcp:127.0.0.1:<port>:<token>` into its parts for a raw test client. */
function parseEndpoint(endpointArg: string): { readonly port: number; readonly token: string } {
  const [, , port, token] = endpointArg.split(':')
  if (port === undefined || token === undefined) throw new Error(`unparseable endpoint: ${endpointArg}`)
  return { port: Number(port), token }
}

/** Collect UTF-8 text from a readable stream until it ends or errors. */
function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    stream.on('data', (chunk: string) => { text += chunk })
    stream.on('end', () => { resolve(text) })
    stream.on('error', reject)
  })
}

const sockets: Socket[] = []
const transports: LoopbackTcpTransport[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  for (const transport of transports.splice(0)) await transport.endStartFailure()
})

describe('selectKernelTransportKind', () => {
  it('selects tcp on win32 and fifo everywhere else', () => {
    expect(selectKernelTransportKind('win32')).toBe('tcp')
    expect(selectKernelTransportKind('darwin')).toBe('fifo')
    expect(selectKernelTransportKind('linux')).toBe('fifo')
  })
})

describe('LoopbackTcpTransport', () => {
  it('accepts a correctly tokened connection and forwards frames after the token line', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const socket = connect(port, '127.0.0.1')
    sockets.push(socket)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    socket.write(`${token}\nREADY\t2\t123\n`)
    const stream = await connected
    socket.end()
    await expect(readAll(stream)).resolves.toBe('READY\t2\t123\n')
  })

  it('destroys a wrong-token connection but keeps listening to the deadline, accepting a later correctly-tokened connection', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const wrong = connect(port, '127.0.0.1')
    sockets.push(wrong)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    wrong.write('wrong-token-not-32-hex\n')
    await new Promise<void>((resolve) => { wrong.once('close', () => { resolve() }) })
    expect(wrong.destroyed).toBe(true)
    // connect() is still pending: a single bad connection must never fail
    // kernel startup outright (see the class's own doc).
    const right = connect(port, '127.0.0.1')
    sockets.push(right)
    right.write(`${token}\nREADY\t2\t123\n`)
    const stream = await connected
    right.end()
    await expect(readAll(stream)).resolves.toBe('READY\t2\t123\n')
  })

  it('destroys a connection that ends before any token line arrives but keeps listening for a later correctly-tokened one', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const early = connect(port, '127.0.0.1')
    sockets.push(early)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    early.end()
    const right = connect(port, '127.0.0.1')
    sockets.push(right)
    right.write(`${token}\n`)
    await expect(connected).resolves.toBeDefined()
  })

  it('destroys a connection that errors before any token line arrives but keeps listening for a later correctly-tokened one', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const early = connect(port, '127.0.0.1')
    sockets.push(early)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    // A plain `destroy()` sends an ordinary FIN the server sees as 'end', not
    // 'error'; only a forced RST reaches the accepted socket's own 'error' listener.
    await new Promise<void>((resolve) => { early.once('connect', () => { resolve() }) })
    early.resetAndDestroy()
    const right = connect(port, '127.0.0.1')
    sockets.push(right)
    right.write(`${token}\n`)
    await expect(connected).resolves.toBeDefined()
  })

  it('destroys a connection whose token line exceeds its bound but keeps listening for a later correctly-tokened one', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const oversized = connect(port, '127.0.0.1')
    sockets.push(oversized)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    oversized.write('a'.repeat(300))
    await new Promise<void>((resolve) => { oversized.once('close', () => { resolve() }) })
    expect(oversized.destroyed).toBe(true)
    const right = connect(port, '127.0.0.1')
    sockets.push(right)
    right.write(`${token}\n`)
    await expect(connected).resolves.toBeDefined()
  })

  it('rejects connect() once its own deadline elapses even after only wrong-token connections arrived', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port } = parseEndpoint(transport.endpointArg)
    const connected = transport.connect(neverExitingHandle(), 50, undefined)
    const wrong = connect(port, '127.0.0.1')
    sockets.push(wrong)
    wrong.write('wrong-token-not-32-hex\n')
    await expect(connected).rejects.toThrow(/did not connect/)
  })

  it('accepts a token split across two writes below the bound, before any newline arrives', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const socket = connect(port, '127.0.0.1')
    sockets.push(socket)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    socket.write(token.slice(0, 8))
    await sleepMs(20)
    socket.write(`${token.slice(8)}\nREADY\t2\t123\n`)
    const stream = await connected
    socket.end()
    await expect(readAll(stream)).resolves.toBe('READY\t2\t123\n')
  })

  it('destroys a connection whose accepted socket throws a non-Error value but keeps listening for a later correctly-tokened one', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const socket = connect(port, '127.0.0.1')
    sockets.push(socket)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    await new Promise<void>((resolve) => { socket.once('connect', () => { resolve() }) })
    // readToken()'s own 'error' listener is only attached once the server's
    // 'connection' handler runs; give that a tick to settle before reaching
    // into the transport's private accepted-socket field.
    await sleepMs(20)
    const accepted = (transport as unknown as { connectionSocket: Socket | undefined }).connectionSocket
    if (accepted === undefined) throw new Error('kernel-transport.spec.ts: server did not record the accepted connection')
    // A real socket only ever emits an Error instance; this exercises the non-Error
    // fallback via a direct emit on the server-side accepted socket, the one
    // readToken()'s own 'error' listener is actually attached to. It classifies
    // and swallows the failure the same as every other bad connection: the
    // listener keeps accepting rather than failing connect() outright.
    accepted.emit('error', 'plain-string-failure' as unknown as Error)
    const right = connect(port, '127.0.0.1')
    sockets.push(right)
    right.write(`${token}\n`)
    await expect(connected).resolves.toBeDefined()
  })

  it('rejects create() when the listener itself errors (an Error instance) before it starts listening', async () => {
    const listenSpy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server) {
      queueMicrotask(() => { this.emit('error', new Error('kernel-transport.spec.ts: injected listen failure')) })
      return this
    })
    try {
      await expect(LoopbackTcpTransport.create()).rejects.toThrow(/injected listen failure/)
    } finally {
      listenSpy.mockRestore()
    }
  })

  it('rejects create() when the listener itself errors (a non-Error value) before it starts listening', async () => {
    const listenSpy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server) {
      queueMicrotask(() => { this.emit('error', 'plain-string-listen-failure' as unknown as Error) })
      return this
    })
    try {
      await expect(LoopbackTcpTransport.create()).rejects.toThrow('plain-string-listen-failure')
    } finally {
      listenSpy.mockRestore()
    }
  })

  it('rejects create() when a successful listen produces no usable address', async () => {
    const addressSpy = vi.spyOn(Server.prototype, 'address').mockReturnValue(null)
    try {
      await expect(LoopbackTcpTransport.create()).rejects.toThrow(/produced no port/)
    } finally {
      addressSpy.mockRestore()
    }
  })

  it('rejects connect() immediately when the caller passes an already-aborted signal', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    await expect(transport.connect(neverExitingHandle(), 5_000, AbortSignal.abort())).rejects.toThrow(/did not connect/)
  })

  it('fails connect() immediately with a listener fault that already happened before connect() was ever called', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    // The long-lived listener error handler installed at construction time
    // is the only thing that can observe a fault landing in the window
    // between create() returning and a caller ever invoking connect() (the
    // real-world case: the kernel process is still spawning); without it,
    // this would be an uncaught 'error' event instead.
    const server = (transport as unknown as { server: Server }).server
    server.emit('error', new Error('kernel-transport.spec.ts: injected pre-connect listener fault'))
    await expect(transport.connect(neverExitingHandle(), 5_000, undefined)).rejects.toThrow('injected pre-connect listener fault')
  })

  it('accepts a correctly-tokened connection that arrives before connect() is ever called', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    // The kernel driver connects as soon as it starts, which can race ahead
    // of this Host process reaching its own connect() call; the persistent
    // 'connection' handler installed at construction time must queue this
    // instead of leaking it with no listener at all.
    const socket = connect(port, '127.0.0.1')
    sockets.push(socket)
    await new Promise<void>((resolve) => { socket.once('connect', () => { resolve() }) })
    socket.write(`${token}\nREADY\t2\t123\n`)
    await sleepMs(20)
    const stream = await transport.connect(neverExitingHandle(), 5_000, undefined)
    socket.end()
    await expect(readAll(stream)).resolves.toBe('READY\t2\t123\n')
  })

  it('queues a wrong-token connection that arrives before connect() is ever called, destroying it once connect() attempts it and still accepting a later correctly-tokened one', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const wrong = connect(port, '127.0.0.1')
    sockets.push(wrong)
    wrong.write('wrong-token-not-32-hex\n')
    await new Promise<void>((resolve) => { wrong.once('connect', () => { resolve() }) })
    await sleepMs(20)
    // Nothing attempts this queued connection's token until a caller
    // actually invokes connect(): no read yet, so still open here.
    expect(wrong.destroyed).toBe(false)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    await new Promise<void>((resolve) => { wrong.once('close', () => { resolve() }) })
    expect(wrong.destroyed).toBe(true)
    const right = connect(port, '127.0.0.1')
    sockets.push(right)
    right.write(`${token}\n`)
    await expect(connected).resolves.toBeDefined()
  })

  it('rejects connect() when the listening server errors (an Error instance) while awaiting a connection', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    // The server object has no public surface for injecting a post-listen
    // fault; reaching through the private field mirrors this suite's own
    // private-field access for otherwise untriggerable defensive paths.
    const server = (transport as unknown as { server: Server }).server
    server.emit('error', new Error('kernel-transport.spec.ts: injected server fault'))
    await expect(connected).rejects.toThrow('kernel-transport.spec.ts: injected server fault')
  })

  it('rejects connect() when the listening server errors (a non-Error value) while awaiting a connection', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    const server = (transport as unknown as { server: Server }).server
    server.emit('error', 'plain-string-server-fault' as unknown as Error)
    await expect(connected).rejects.toThrow('plain-string-server-fault')
  })

  it('refuses a second connection once the first has arrived, valid token or not', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const first = connect(port, '127.0.0.1')
    sockets.push(first)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    first.write(`${token}\n`)
    await connected
    // The listener already stopped accepting inside the first connection's
    // own handler; give it a tick to fully settle before the second attempt.
    await sleepMs(20)
    const second = connect(port, '127.0.0.1')
    sockets.push(second)
    const refused = await new Promise<string>((resolve) => {
      second.once('error', (error: NodeJS.ErrnoException) => { resolve(error.code ?? 'error') })
      second.once('connect', () => { resolve('connected') })
    })
    expect(refused).toBe('ECONNREFUSED')
  })

  it('maps a client-closed connection to a plain stream end, the same signal the FIFO path\'s reader stdout produces', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const { port, token } = parseEndpoint(transport.endpointArg)
    const socket = connect(port, '127.0.0.1')
    sockets.push(socket)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    socket.write(`${token}\n`)
    const stream = await connected
    const ended = new Promise<void>((resolve) => { stream.once('end', () => { resolve() }) })
    socket.end()
    await ended
  })

  it('rejects connect() when the kernel process exits before ever connecting', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    const exited = Promise.resolve({ exitCode: 1, signal: null })
    const handle = { done: exited } as unknown as SubprocessHandle
    await expect(transport.connect(handle, 5_000, undefined)).rejects.toThrow(/exited before connecting/)
  })

  it('rejects connect() once its own deadline elapses with no connection', async () => {
    const transport = await LoopbackTcpTransport.create()
    transports.push(transport)
    await expect(transport.connect(neverExitingHandle(), 50, undefined)).rejects.toThrow(/did not connect/)
  })

  it('teardown closes the listener: a fresh connection attempt to the same port is refused', async () => {
    const transport = await LoopbackTcpTransport.create()
    const { port } = parseEndpoint(transport.endpointArg)
    await transport.end()
    const probe = connect(port, '127.0.0.1')
    sockets.push(probe)
    const refused = await new Promise<string>((resolve) => {
      probe.once('error', (error: NodeJS.ErrnoException) => { resolve(error.code ?? 'error') })
      probe.once('connect', () => { resolve('connected') })
    })
    expect(refused).toBe('ECONNREFUSED')
  })

  it('end() destroys a connection still queued and unattempted (connect() never called)', async () => {
    const transport = await LoopbackTcpTransport.create()
    const { port } = parseEndpoint(transport.endpointArg)
    const socket = connect(port, '127.0.0.1')
    sockets.push(socket)
    await new Promise<void>((resolve) => { socket.once('connect', () => { resolve() }) })
    await sleepMs(20)
    expect(socket.destroyed).toBe(false)
    await transport.end()
    await new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
    expect(socket.destroyed).toBe(true)
  })

  it('endStartFailure also closes the listener and destroys a connection still queued and unattempted (connect() never called)', async () => {
    const transport = await LoopbackTcpTransport.create()
    const { port } = parseEndpoint(transport.endpointArg)
    const socket = connect(port, '127.0.0.1')
    sockets.push(socket)
    await new Promise<void>((resolve) => { socket.once('connect', () => { resolve() }) })
    await sleepMs(20)
    expect(socket.destroyed).toBe(false)
    await transport.endStartFailure()
    await new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
    expect(socket.destroyed).toBe(true)
  })

  it('endStartFailure also closes the listener and destroys any accepted connection', async () => {
    const transport = await LoopbackTcpTransport.create()
    const { port, token } = parseEndpoint(transport.endpointArg)
    const socket = connect(port, '127.0.0.1')
    sockets.push(socket)
    const connected = transport.connect(neverExitingHandle(), 5_000, undefined)
    socket.write(`${token}\n`)
    await connected
    await transport.endStartFailure()
    const probe = connect(port, '127.0.0.1')
    sockets.push(probe)
    const refused = await new Promise<string>((resolve) => {
      probe.once('error', (error: NodeJS.ErrnoException) => { resolve(error.code ?? 'error') })
      probe.once('connect', () => { resolve('connected') })
    })
    expect(refused).toBe('ECONNREFUSED')
  })
})
