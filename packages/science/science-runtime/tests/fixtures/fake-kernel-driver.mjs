#!/usr/bin/env node
// Fake D2-protocol kernel driver for KernelProcess unit tests. Speaks the
// real frame grammar (READY/RUN/DONE/EXIT) but never executes real Python/R
// source: each RUN's sourcePath holds a small JSON action object that tells
// this driver exactly what to reply, so tests script precise protocol
// behavior deterministically without a real interpreter.
//
// Usage: node fake-kernel-driver.mjs <fifoPath>
//
// Per-run JSON action shape (all fields optional):
//   { "action": "reply", "status": "ok"|"error"|"interrupted", "detail": "...", "flags": "..." }
//   { "action": "garbage" }            -- writes one unparseable line instead of DONE
//   { "action": "crash" }              -- process.exit(1) without replying
//   { "action": "close-fifo" }         -- closes the write end, stays alive, never replies
//   { "action": "sleep", "sleepMs": 5000, "trapSigint": true|false, ...reply fields }
//     -- trapSigint true: a caught SIGINT immediately replies DONE interrupted;
//        trapSigint false/absent: SIGINT is installed as a no-op listener, so
//        the process survives it and keeps sleeping (Node's default SIGINT
//        disposition would otherwise terminate the process).

import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = 1

const fifoPath = process.argv[2]
if (fifoPath === undefined) {
  process.stderr.write('usage: fake-kernel-driver.mjs <fifoPath>\n')
  process.exit(2)
}

let fifoFd = openSync(fifoPath, 'w')
let fifoClosed = false

function send(frame) {
  if (fifoClosed) return
  writeSync(fifoFd, `${frame}\n`)
}

function closeFifo() {
  if (fifoClosed) return
  fifoClosed = true
  closeSync(fifoFd)
}

send(`READY\t${PROTOCOL_VERSION}\t${process.pid}`)

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
  const kind = action.action ?? 'reply'
  const status = action.status ?? 'ok'
  const detail = action.detail ?? ''
  const flags = action.flags ?? ''

  if (kind === 'reply') {
    send(`DONE\t${runId}\t${status}\t${detail}\t${flags}`)
    return
  }
  if (kind === 'garbage') {
    send('THIS-IS-NOT-A-VALID-FRAME')
    return
  }
  if (kind === 'crash') {
    process.exit(1)
  }
  if (kind === 'close-fifo') {
    closeFifo()
    return
  }
  if (kind === 'sleep') {
    const sleepMs = action.sleepMs ?? 5_000
    let timer
    if (action.trapSigint === true) {
      const onSigint = () => {
        clearTimeout(timer)
        process.removeListener('SIGINT', onSigint)
        send(`DONE\t${runId}\tinterrupted\t\t`)
      }
      process.on('SIGINT', onSigint)
    } else {
      process.on('SIGINT', () => {})
    }
    timer = setTimeout(() => {
      send(`DONE\t${runId}\t${status}\t${detail}\t${flags}`)
    }, sleepMs)
    return
  }
  send(`DONE\t${runId}\terror\tUnknownAction\t`)
}
