#!/usr/bin/env node
// Fake D2-protocol persistent-kernel driver for the keyless Science tools
// snapshot. `fake-conda/bin/python` (written by `prepareScienceFixture`)
// discards the real interpreter argv science-runtime builds — including the
// real production driver path it names, never valid to run under Node — and
// execs this script against only the response-FIFO path instead, so no real
// Python interpreter or driver source is required. It ignores every RUN
// frame's actual source (the scripted mock model sends illustrative Python
// it never executes) and performs the same deterministic artifact-writing
// side effect on every run that the pre-persistent-kernel one-shot fixture
// performed at spawn time, then replies DONE ok.
//
// Usage: node science-kernel-driver.cjs <fifoPath>

const { closeSync, existsSync, mkdirSync, openSync, writeFileSync, writeSync } = require('node:fs')
const { join } = require('node:path')
const { createInterface } = require('node:readline')

const PROTOCOL_VERSION = 1

// The exact PNG bytes `headless.snapshot.ts` also pins as `SCIENCE_PNG`.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const fifoPath = process.argv[2]
if (fifoPath === undefined) {
  process.stderr.write('usage: science-kernel-driver.cjs <fifoPath>\n')
  process.exit(2)
}

const fifoFd = openSync(fifoPath, 'w')
let fifoClosed = false
function send(frame) {
  if (fifoClosed) return
  writeSync(fifoFd, `${frame}\n`)
}

send(`READY\t${PROTOCOL_VERSION}\t${process.pid}`)
// Idle SIGINT is a no-op (D2's real-driver contract); this snapshot never
// interrupts a run, but a stray signal must not kill the kernel mid-scenario.
process.on('SIGINT', () => {})

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  if (line.length === 0) return
  const parts = line.split('\t')
  if (parts[0] === 'EXIT') {
    fifoClosed = true
    closeSync(fifoFd)
    process.exit(0)
  }
  if (parts[0] !== 'RUN') return
  const [, runId, , cwd, stdoutPath, stderrPath, artifactDir] = parts
  mkdirSync(artifactDir, { recursive: true })
  // One file per allowlisted auto-capture media type this snapshot pins —
  // csv, json, vl.json, md, and png — proving one science/artifact-saved event per file.
  writeFileSync(join(artifactDir, 'summary.csv'), 'metric,value\naccuracy,0.97\n')
  writeFileSync(join(artifactDir, 'meta.json'), '{"ok":true}\n')
  writeFileSync(join(artifactDir, 'chart.vl.json'), '{"$schema":"https://vega.github.io/schema/vega-lite/v6.json","data":{"values":[{"metric":"accuracy","value":0.97}]},"mark":"bar","encoding":{"x":{"field":"metric","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}\n')
  writeFileSync(join(artifactDir, 'notes.md'), '# Notes\n\nDeterministic snapshot run.\n')
  writeFileSync(join(artifactDir, 'plot.png'), PNG)
  if (existsSync(join(cwd, 'inputs', 'source.png'))) writeFileSync(join(artifactDir, 'edited.png'), PNG)
  if (existsSync(join(cwd, 'inputs', 'region-source.png'))) writeFileSync(join(artifactDir, 'region-edit.png'), PNG)
  if (existsSync(join(cwd, 'inputs', 'region-source-1.png'))) writeFileSync(join(artifactDir, 'region-edit-1.png'), PNG)
  if (existsSync(join(cwd, 'inputs', 'source.vl.json'))) {
    writeFileSync(join(artifactDir, 'selected-edit.vl.json'), '{"mark":"bar","encoding":{"y":{"scale":{"zero":true}}}}\n')
  }
  if (existsSync(join(cwd, 'inputs', 'source-2.vl.json'))) {
    writeFileSync(join(artifactDir, 'selected-edit-2.vl.json'), '{"mark":"bar","encoding":{"x":{"axis":{"labelAngle":0}}}}\n')
  }
  writeFileSync(stdoutPath, 'science snapshot run output\n')
  writeFileSync(stderrPath, '')
  send(`DONE\t${runId}\tok\t\t`)
})
