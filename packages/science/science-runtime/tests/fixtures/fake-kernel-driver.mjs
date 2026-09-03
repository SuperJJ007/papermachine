#!/usr/bin/env node
// Fake kernel-wire-protocol driver for KernelProcess unit tests. Speaks the
// real frame grammar (READY/RUN/DONE/EXIT) but never executes real Python/R
// source: each RUN's sourcePath holds a small JSON action object that tells
// this driver exactly what to reply, so tests script precise protocol
// behavior deterministically without a real interpreter.
//
// Usage: node fake-kernel-driver.mjs <fifoPath>
//
// Per-run JSON action shape (all fields optional):
//   { "action": "reply", "status": "ok"|"error"|"interrupted", "detail": "...", "flags": "..." }
//   { "action": "echo-request" }       -- replies DONE ok with detail = "<cwd>|<artifactDir>|<inputDir>"
//   { "action": "garbage" }            -- writes one unparseable line instead of DONE
//   { "action": "double-garbage" }     -- writes two unparseable lines instead of DONE
//   { "action": "crash" }              -- process.exit(1) without replying
//   { "action": "close-fifo" }         -- closes the write end, stays alive, never replies
//   { "action": "sleep", "sleepMs": 5000, "trapSigint": true|false, ...reply fields }
//     -- trapSigint true: a caught SIGINT immediately replies DONE interrupted;
//        trapSigint false/absent: SIGINT is installed as a no-op listener, so
//        the process survives it and keeps sleeping (Node's default SIGINT
//        disposition would otherwise terminate the process).

import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = 2

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
  if (cmd === 'CHART_EXTRACT') {
    const request = JSON.parse(readFileSync(parts[2], 'utf8'))
    if (request.testAction === 'hang') return
    if (request.testAction === 'wrong-frame') {
      send(`DONE\t${parts[1]}\tok\t\t`)
      return
    }
    if (request.testAction === 'error') {
      send(`CHART\t${parts[1]}\terror\tChartError`)
      return
    }
    writeFileSync(parts[3], JSON.stringify(request.testResult ?? { charts: {}, errors: {} }))
    send(`CHART\t${parts[1]}\tok\t`)
    return
  }
  if (cmd === 'CHART_APPLY') {
    const request = JSON.parse(readFileSync(parts[2], 'utf8'))
    if (request.testAction === 'hang') return
    if (request.testAction === 'not_registered') {
      send(`CHART\t${parts[1]}\terror\tnot_registered`)
      return
    }
    writeFileSync(request.outputPath, Buffer.from(request.testPngBase64 ?? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    writeFileSync(parts[3], JSON.stringify(request.testResult ?? {
      chart: { runtime: 'matplotlib', png: { width: 1, height: 1, dpi: request.dpi }, elements: [], hitmap: [], hitmapStatus: 'ok' },
      failedOps: [],
    }))
    send(`CHART\t${parts[1]}\tok\t`)
    return
  }
  if (cmd !== 'RUN') return
  const runId = parts[1]
  const sourcePath = parts[2]
  const cwd = parts[3]
  const artifactDir = parts[6]
  const inputDir = parts[7]
  handleRun(runId, sourcePath, cwd, artifactDir, inputDir)
})

function handleRun(runId, sourcePath, cwd, artifactDir, inputDir) {
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

  if (kind === 'echo-request') {
    send(`DONE\t${runId}\tok\t${cwd}|${artifactDir}|${inputDir}\t`)
    return
  }
  if (kind === 'echo-workspace') {
    send(`DONE\t${runId}\tok\t${process.env.SCIENCE_WORKSPACE_DIR ?? ''}\t`)
    return
  }
  if (kind === 'reply') {
    send(`DONE\t${runId}\t${status}\t${detail}\t${flags}`)
    return
  }
  if (kind === 'garbage') {
    send('THIS-IS-NOT-A-VALID-FRAME')
    return
  }
  if (kind === 'double-garbage') {
    send('THIS-IS-NOT-A-VALID-FRAME-1')
    send('THIS-IS-NOT-A-VALID-FRAME-2')
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
