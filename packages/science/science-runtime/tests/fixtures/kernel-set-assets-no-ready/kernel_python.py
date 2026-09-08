#!/usr/bin/env node
// CommonJS fake kernel driver that never sends READY: exercises
// KernelProcess's spawn-to-READY deadline through KernelSet/ScienceRuntime
// rather than KernelProcess directly (see `fake-kernel-driver-no-ready.mjs`,
// KernelProcess's own ESM sibling fixture; `kernel-set-assets/kernel_python.py`
// explains why this directory ports it to CommonJS). Stays alive so the
// timeout, not a process exit, is what the caller observes.
const endpoint = process.argv[2]
if (endpoint?.startsWith('tcp:')) {
  const [, host, port, token] = endpoint.split(':')
  const socket = require('node:net').createConnection({ host, port: Number(port) })
  socket.write(`${token}\n`)
}
setInterval(() => {}, 1000)
