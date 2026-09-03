import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createTelemetryServer, resolveServerPort } from '../aliyun-fc/server.mjs'
import { validEvent } from './fixtures.mjs'

describe('resolveServerPort', () => {
  it('defaults to 9000 when FC_SERVER_PORT is unset', () => {
    assert.equal(resolveServerPort(undefined), 9000)
  })

  it('parses a configured FC_SERVER_PORT', () => {
    assert.equal(resolveServerPort('9100'), 9100)
  })

  it('rejects a non-integer FC_SERVER_PORT', () => {
    assert.throws(() => resolveServerPort('not-a-port'), /FC_SERVER_PORT must be an integer/u)
    assert.throws(() => resolveServerPort('9000.5'), /FC_SERVER_PORT must be an integer/u)
  })
})

describe('Aliyun Function Compute receiver', () => {
  const loggedLines = []
  const server = createTelemetryServer({ log: line => loggedLines.push(line) })
  let endpoint

  before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.notEqual(address, null)
    assert.equal(typeof address, 'object')
    endpoint = `http://127.0.0.1:${address.port}/`
  })

  after(async () => {
    await new Promise((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
  })

  it('returns an empty 204 and logs only the validated event JSON', async () => {
    const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(validEvent) })
    assert.equal(response.status, 204)
    assert.equal(await response.text(), '')
    assert.deepEqual(JSON.parse(loggedLines.at(-1)), validEvent)
  })

  it('rejects methods, invalid events, and oversized bodies without logging', async () => {
    const beforeCount = loggedLines.length
    assert.equal((await fetch(endpoint)).status, 405)
    assert.equal((await fetch(endpoint, { method: 'POST', body: JSON.stringify({ ...validEvent, eventId: 'bad' }) })).status, 400)
    assert.equal((await fetch(endpoint, { method: 'POST', body: 'x'.repeat(8193) })).status, 413)
    assert.equal(loggedLines.length, beforeCount)
  })
})
