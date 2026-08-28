#!/usr/bin/env node
// CommonJS fake kernel-wire-protocol driver for KernelSet unit tests. A
// `kernel_python.py` / `kernel_r.R` pair under one `assetsRoot` is what
// `resolveKernelDriverPath` requires (see `kernel-assets.ts`); this
// directory's own `package.json` pins `"type": "commonjs"` so Node accepts
// these unrecognized extensions as CommonJS despite this package's own
// `"type": "module"` above it. Content is deliberately identical between
// the two files and to `fake-kernel-driver.mjs` (KernelProcess's ESM
// sibling fixture) minus its `sleep` action, which KernelSet's own tests
// never need: never executes real Python/R source — each RUN's sourcePath
// holds a small JSON action object that tells this driver exactly what to
// reply, so tests script precise protocol behavior deterministically.
//
// Usage: node kernel_python.py <fifoPath>
//
// Per-run JSON action shape (all fields optional):
//   { "action": "reply", "status": "ok"|"error"|"interrupted", "detail": "...", "flags": "..." }
//   { "action": "garbage" }            -- writes one unparseable line instead of DONE
//   { "action": "crash" }              -- process.exit(1) without replying

const { closeSync, openSync, readFileSync, writeFileSync, writeSync } = require('node:fs')
const { createInterface } = require('node:readline')

const PROTOCOL_VERSION = 2

const fifoPath = process.argv[2]
if (fifoPath === undefined) {
  process.stderr.write('usage: kernel_python.py <fifoPath>\n')
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
    writeFileSync(parts[3], '{"charts":{},"errors":{}}')
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
  send(`DONE\t${runId}\terror\tUnknownAction\t`)
}
