#!/usr/bin/env node
// Fake kernel driver that never sends READY: exercises KernelProcess's
// spawn-to-READY deadline. Stays alive (does not exit) so the timeout, not a
// process exit, is what KernelProcess.start() observes.
import { createConnection } from 'node:net'

const endpoint = process.argv[2]
if (endpoint?.startsWith('tcp:')) {
  const [, host, port, token] = endpoint.split(':')
  createConnection({ host, port: Number(port) }).write(`${token}\n`)
}
setInterval(() => {}, 1_000)
