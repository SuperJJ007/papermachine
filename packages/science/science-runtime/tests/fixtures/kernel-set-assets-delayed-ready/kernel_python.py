#!/usr/bin/env node
// CommonJS fake kernel-wire-protocol driver for KernelSet's dispose/detach-
// during-spawn race test: delays its READY handshake by a fixed window
// before opening the response FIFO's write side, so a spawn is still in
// flight (post-subprocess-spawn, pre-READY) when the test's detach/dispose
// call fires. Otherwise identical to `kernel-set-assets/kernel_python.py`
// (see that file's own header for the shared CommonJS/`package.json` note).
//
// Usage: node kernel_python.py <fifoPath>

const { closeSync, openSync, readFileSync, writeFileSync, writeSync } = require('node:fs')
const { createInterface } = require('node:readline')

const PROTOCOL_VERSION = 2
const READY_DELAY_MS = 300

const fifoPath = process.argv[2]
if (fifoPath === undefined) {
  process.stderr.write('usage: kernel_python.py <fifoPath>\n')
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
  if (cmd === 'CHART_EXTRACT') {
    writeFileSync(parts[3], '{"charts":{},"errors":{}}')
    send(`CHART\t${parts[1]}\tok\t`)
    return
  }
  if (cmd === 'CHART_APPLY') {
    const request = JSON.parse(readFileSync(parts[2], 'utf8'))
    writeFileSync(request.outputPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    writeFileSync(parts[3], JSON.stringify({ chart: { runtime: 'matplotlib', png: { width: 1, height: 1, dpi: request.dpi }, elements: [], hitmap: [], hitmapStatus: 'ok' }, failedOps: [] }))
    send(`CHART\t${parts[1]}\tok\t`)
    return
  }
  if (cmd !== 'RUN') return
  handleRun(parts[1], parts[2])
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
