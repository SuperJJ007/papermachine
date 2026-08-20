#!/usr/bin/env node
// Fake kernel-wire-protocol driver that delays its READY handshake by a fixed
// window before opening the response FIFO's write side: exercises a spawn
// still in flight (post-subprocess-spawn, pre-READY) when a concurrent
// detach/disposeAll fires (the spawn-vs-teardown race). Speaks
// the ordinary kernel wire protocol afterward, identical to fake-kernel-driver.mjs's
// `reply` action.
//
// Usage: node fake-kernel-driver-delayed-ready.mjs <fifoPath>

import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = 1
const READY_DELAY_MS = 300

const fifoPath = process.argv[2]
if (fifoPath === undefined) {
  process.stderr.write('usage: fake-kernel-driver-delayed-ready.mjs <fifoPath>\n')
  process.exit(2)
}

let fifoFd
let fifoClosed = false

function send(frame) {
  if (fifoFd === undefined || fifoClosed) return
  writeSync(fifoFd, `${frame}\n`)
}

function closeFifo() {
  if (fifoClosed) return
  fifoClosed = true
  closeSync(fifoFd)
}

setTimeout(() => {
  fifoFd = openSync(fifoPath, 'w')
  send(`READY\t${PROTOCOL_VERSION}\t${process.pid}`)
}, READY_DELAY_MS)

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', (line) => {
  if (line.length === 0) return
  const parts = line.split('\t')
  const cmd = parts[0]
  if (cmd === 'EXIT') {
    closeFifo()
    process.exit(0)
  }
  if (cmd !== 'RUN') return
  const runId = parts[1]
  const sourcePath = parts[2]
  handleRun(runId, sourcePath)
})

function handleRun(runId, sourcePath) {
  let action
  try {
    action = JSON.parse(readFileSync(sourcePath, 'utf8'))
  } catch {
    send(`DONE\t${runId}\terror\tActionParseError\t`)
    return
  }
  const status = action.status ?? 'ok'
  const detail = action.detail ?? ''
  const flags = action.flags ?? ''
  send(`DONE\t${runId}\t${status}\t${detail}\t${flags}`)
}
