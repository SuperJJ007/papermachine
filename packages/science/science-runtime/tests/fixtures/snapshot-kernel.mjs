/** Exact Python-operation fixture behind the production kernel protocol. */
import { openSync, readFileSync, writeFileSync, writeSync, closeSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createConnection } from 'node:net'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  process.stdout.write('Python 3.13.15\n')
} else if (args.includes('-m')) {
  process.stdout.write('[]\n')
} else if (args.includes('-c')) {
  process.stdout.write('dsh-科学-✓')
} else {
  const address = args.at(-1)
  if (!address) throw new Error('kernel fixture requires a protocol endpoint')
  const tcp = address.startsWith('tcp:') ? address.split(':') : undefined
  const socket = tcp ? createConnection({ host: tcp[1], port: Number(tcp[2]) }) : undefined
  const fd = socket ? undefined : openSync(address, 'w')
  const send = (line) => socket ? socket.write(line + '\n') : writeSync(fd, line + '\n')
  if (socket) socket.write(tcp[3] + '\n')
  send(`READY\t2\t${process.pid}`)
  process.on('SIGINT', () => {})
  const input = createInterface({ input: process.stdin, terminal: false })
  input.on('line', (line) => {
    const parts = line.split('\t')
    switch (parts[0]) {
      case 'RUN': {
        const source = readFileSync(parts[2], 'utf8')
        const expected = readFileSync(new URL('./snapshot-operation.py', import.meta.url), 'utf8')
        if (source.trim() !== expected.trim()) {
          send(`DONE\t${parts[1]}\terror\tUnexpectedSnapshotSource\t`)
          return
        }
        writeFileSync(parts[4], 'SCIENCE_SNAPSHOT_RUN_OK\n')
        writeFileSync(parts[5], '')
        copyFileSync(new URL('./snapshot-plot.png', import.meta.url), join(parts[6], 'plot.png'))
        send(`DONE\t${parts[1]}\tok\t\t`)
        break
      }
      case 'CHART_EXTRACT':
        writeFileSync(parts[3], JSON.stringify({ charts: {}, errors: {} }))
        send(`CHART\t${parts[1]}\tok\t`)
        break
      case 'EXIT':
        if (socket) socket.end()
        else closeSync(fd)
        input.close()
        break
      default:
        throw new Error(`unsupported kernel fixture command: ${parts[0]}`)
    }
  })
}
