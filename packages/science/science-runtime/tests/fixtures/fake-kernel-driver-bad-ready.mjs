#!/usr/bin/env node
// Fake kernel driver that sends one malformed line instead of a valid READY
// frame: exercises KernelProcess's handshake-time protocol-violation path (a
// driver bug caught before the handshake ever transitions to 'ready'),
// distinct from fake-kernel-driver-no-ready.mjs's silent timeout.
//
// Usage: node fake-kernel-driver-bad-ready.mjs <fifoPath>

import { openSync, writeSync } from 'node:fs'

const fifoPath = process.argv[2]
if (fifoPath === undefined) {
  process.stderr.write('usage: fake-kernel-driver-bad-ready.mjs <fifoPath>\n')
  process.exit(2)
}

const fifoFd = openSync(fifoPath, 'w')
writeSync(fifoFd, 'NOT-A-READY-FRAME\n')

// Stays alive so the malformed-line reaction, not a process exit, is what
// KernelProcess.start() observes; terminate() ends it during cleanup.
setInterval(() => {}, 1_000)
