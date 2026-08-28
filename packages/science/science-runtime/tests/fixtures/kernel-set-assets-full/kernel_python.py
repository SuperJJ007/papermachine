#!/usr/bin/env node
// CommonJS fake kernel-wire-protocol driver for full-pipeline tests
// (run.spec.ts/lifecycle.spec.ts/failures.spec.ts), reached through
// `KernelSet`/`ScienceRuntime.startRun` rather than `KernelProcess` directly.
// Identical protocol surface to `fake-kernel-driver.mjs` (KernelProcess's own
// fixture, including `sleep`/`trapSigint` for interrupt-first coverage); ported
// to CommonJS because a `kernel_python.py` / `kernel_r.R` pair under one
// `assetsRoot` is what `resolveKernelDriverPath` requires (see
// `kernel-assets.ts`), and this directory's own `package.json` pins
// `"type": "commonjs"` so Node accepts these unrecognized extensions despite
// the repo's own `"type": "module"`. Never executes real Python/R source:
// each RUN's sourcePath holds a small JSON action object that tells this
// driver exactly what to reply.
//
// Usage: node kernel_python.py <fifoPath>
//
// Per-run JSON action shape (all fields optional):
//   { "action": "reply", "status": "ok"|"error"|"interrupted", "detail": "...", "flags": "...", "stdout": "...", "stderr": "...", "artifact": "tiny-png" }
//     -- stdout/stderr, when present, are written verbatim to the RUN frame's
//        own stdoutPath/stderrPath before DONE, modeling the wire protocol's own output capture.
//     -- artifact tiny-png writes plot.png into the RUN frame's
//        artifactDir for assembled auto-capture fixtures.
//   { "action": "garbage" }            -- writes one unparseable line instead of DONE
//   { "action": "crash" }              -- process.exit(1) without replying
//   { "action": "close-fifo" }         -- closes the write end, stays alive, never replies
//   { "action": "sleep", "sleepMs": 5000, "trapSigint": true|false, ...reply fields }
//     -- trapSigint true: a caught SIGINT immediately replies DONE interrupted;
//        trapSigint false/absent: SIGINT is installed as a no-op listener, so
//        the process survives it and keeps sleeping.

const { closeSync, openSync, readFileSync, writeFileSync, writeSync } = require('node:fs')
const { join } = require('node:path')
const { createInterface } = require('node:readline')

const PROTOCOL_VERSION = 2
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

const fifoPath = process.argv[2]
if (fifoPath === undefined) {
  process.stderr.write('usage: kernel_python.py <fifoPath>\n')
  process.exit(2)
}

let fifoFd = openSync(fifoPath, 'w')
let fifoClosed = false
const runActions = new Map()
const chartApplyCalls = new Map()

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

// Ignore SIGINT while idle, matching the real driver's own contract ("SIGINT
// ignored except during exec"): only the sleep action's own trapSigint
// handler ever reacts to it. Without this, an interrupt() aimed at a
// between-runs kernel would hit Node's default (terminating) disposition.
process.on('SIGINT', () => {})

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
    const action = runActions.get(parts[1])
    if (action?.chartStatus === 'hang') return
    if (action?.chartStatus === 'crash') process.exit(1)
    if (action?.chartStatus === 'error') {
      send(`CHART\t${parts[1]}\terror\tChartError`)
      return
    }
    if (action?.chartStatus !== 'missing-result') {
      writeFileSync(parts[3], JSON.stringify(action?.chartResult ?? { charts: {}, errors: {} }))
    }
    send(`CHART\t${parts[1]}\tok\t`)
    return
  }
  if (cmd === 'CHART_APPLY') {
    const action = runActions.get(parts[1])
    const call = (chartApplyCalls.get(parts[1]) ?? 0) + 1
    chartApplyCalls.set(parts[1], call)
    if (action?.chartApplyStatus === 'hang') return
    if (action?.chartApplyStatus === 'not_registered' || (action?.chartApplyStatus === 'not_registered_once' && call === 1)) {
      send(`CHART\t${parts[1]}\terror\tnot_registered`)
      return
    }
    const request = JSON.parse(readFileSync(parts[2], 'utf8'))
    writeFileSync(request.outputPath, TINY_PNG)
    writeFileSync(parts[3], JSON.stringify(action?.chartApplyResult ?? { chart: { runtime: 'matplotlib', png: { width: 1, height: 1, dpi: request.dpi }, elements: [], hitmap: [], hitmapStatus: 'ok' }, failedOps: [] }))
    send(`CHART\t${parts[1]}\tok\t`)
    return
  }
  if (cmd !== 'RUN') return
  handleRun(parts[1], parts[2], parts[4], parts[5], parts[6])
})

function handleRun(runId, sourcePath, stdoutPath, stderrPath, artifactDir) {
  let action
  try {
    action = JSON.parse(readFileSync(sourcePath, 'utf8'))
  } catch {
    send(`DONE\t${runId}\terror\tActionParseError\t`)
    return
  }
  const kind = action.action || 'reply'
  runActions.set(runId, action)
  const status = action.status || 'ok'
  const detail = action.detail || ''
  const flags = action.flags || ''
  if (typeof action.stdout === 'string') writeFileSync(stdoutPath, action.stdout)
  if (typeof action.stderr === 'string') writeFileSync(stderrPath, action.stderr)
  if (action.artifact === 'tiny-png') writeFileSync(join(artifactDir, 'plot.png'), TINY_PNG)

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
    const sleepMs = action.sleepMs || 5000
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
