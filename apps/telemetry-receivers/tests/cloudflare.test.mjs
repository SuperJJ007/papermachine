import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../cloudflare/worker.mjs'
import { validEvent } from './fixtures.mjs'

function createDatabase() {
  const rows = new Map()
  return {
    rows,
    prepare(sql) {
      assert.match(sql, /INSERT OR IGNORE INTO events/u)
      return {
        bind(...values) {
          return {
            async run() {
              if (!rows.has(values[0])) rows.set(values[0], values)
            },
          }
        },
      }
    },
  }
}

function post(body) {
  return new Request('https://telemetry.example/', { method: 'POST', body })
}

describe('Cloudflare Worker receiver', () => {
  it('inserts once by eventId and returns an empty 204 for duplicates', async () => {
    const database = createDatabase()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await worker.fetch(post(JSON.stringify(validEvent)), { DB: database })
      assert.equal(response.status, 204)
      assert.equal(await response.text(), '')
    }
    assert.equal(database.rows.size, 1)
    assert.equal(database.rows.get(validEvent.eventId)[1], validEvent.anonymousId)
  })

  it('rejects methods, invalid events, and oversized bodies without querying D1', async () => {
    const database = createDatabase()
    assert.equal((await worker.fetch(new Request('https://telemetry.example/'), { DB: database })).status, 405)
    assert.equal((await worker.fetch(post(JSON.stringify({ ...validEvent, schemaVersion: 2 })), { DB: database })).status, 400)
    assert.equal((await worker.fetch(post('x'.repeat(8193)), { DB: database })).status, 413)
    assert.equal(database.rows.size, 0)
  })

  it('returns an empty 500 when D1 rejects the insert', async () => {
    const database = {
      prepare() {
        return { bind: () => ({ run: async () => { throw new Error('D1 unavailable') } }) }
      },
    }
    const response = await worker.fetch(post(JSON.stringify(validEvent)), { DB: database })
    assert.equal(response.status, 500)
    assert.equal(await response.text(), '')
  })
})
