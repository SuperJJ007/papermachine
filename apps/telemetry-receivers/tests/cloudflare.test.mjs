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

function createRateLimiter(success = true) {
  const keys = []
  return {
    keys,
    async limit({ key }) {
      keys.push(key)
      return { success }
    },
  }
}

function createThrowingRateLimiter() {
  const keys = []
  return {
    keys,
    async limit({ key }) {
      keys.push(key)
      throw new Error('rate limiter unavailable')
    },
  }
}

function environment(database, rateLimiter = createRateLimiter()) {
  return { DB: database, TELEMETRY_RATE_LIMIT: rateLimiter }
}

function post(body, connectingIp = undefined) {
  const headers = connectingIp === undefined ? undefined : { 'cf-connecting-ip': connectingIp }
  return new Request('https://telemetry.example/', { method: 'POST', body, headers })
}

describe('Cloudflare Worker receiver', () => {
  it('inserts once by eventId and returns an empty 204 for duplicates', async () => {
    const database = createDatabase()
    const rateLimiter = createRateLimiter()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await worker.fetch(post(JSON.stringify(validEvent)), environment(database, rateLimiter))
      assert.equal(response.status, 204)
      assert.equal(await response.text(), '')
    }
    assert.equal(database.rows.size, 1)
    assert.equal(database.rows.get(validEvent.eventId)[1], validEvent.anonymousId)
    assert.deepEqual(rateLimiter.keys, ['unknown', 'unknown'])
  })

  it('rejects methods, invalid events, and oversized bodies without querying D1', async () => {
    const database = createDatabase()
    const rateLimiter = createRateLimiter()
    const env = environment(database, rateLimiter)
    assert.equal((await worker.fetch(new Request('https://telemetry.example/'), env)).status, 405)
    assert.equal((await worker.fetch(post(JSON.stringify({ ...validEvent, schemaVersion: 2 })), env)).status, 400)
    assert.equal((await worker.fetch(post('x'.repeat(8193)), env)).status, 413)
    assert.equal(database.rows.size, 0)
    assert.deepEqual(rateLimiter.keys, [])
  })

  it('rate limits validated events by connecting IP before D1 persistence', async () => {
    const allowedDatabase = createDatabase()
    const allowedRateLimiter = createRateLimiter()
    const allowed = await worker.fetch(
      post(JSON.stringify(validEvent), '203.0.113.4'),
      environment(allowedDatabase, allowedRateLimiter),
    )
    assert.equal(allowed.status, 204)
    assert.deepEqual(allowedRateLimiter.keys, ['203.0.113.4'])
    assert.equal(allowedDatabase.rows.size, 1)

    const rejectedDatabase = createDatabase()
    const rejectedRateLimiter = createRateLimiter(false)
    const rejected = await worker.fetch(
      post(JSON.stringify(validEvent), '203.0.113.5'),
      environment(rejectedDatabase, rejectedRateLimiter),
    )
    assert.equal(rejected.status, 429)
    assert.equal(await rejected.text(), '')
    assert.deepEqual(rejectedRateLimiter.keys, ['203.0.113.5'])
    assert.equal(rejectedDatabase.rows.size, 0)
  })

  it('fails open and writes the row when the rate limiter throws', async () => {
    const database = createDatabase()
    const rateLimiter = createThrowingRateLimiter()
    const response = await worker.fetch(
      post(JSON.stringify(validEvent), '203.0.113.6'),
      environment(database, rateLimiter),
    )
    assert.equal(response.status, 204)
    assert.deepEqual(rateLimiter.keys, ['203.0.113.6'])
    assert.equal(database.rows.size, 1)
  })

  it('returns 413 for an oversized body even when the reader rejects cancel()', async () => {
    const database = createDatabase()
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(8193)))
        controller.close()
      },
      cancel() {
        throw new Error('cancel not supported')
      },
    })
    const request = new Request('https://telemetry.example/', { method: 'POST', body, duplex: 'half' })
    const response = await worker.fetch(request, environment(database))
    assert.equal(response.status, 413)
    assert.equal(database.rows.size, 0)
  })

  it('returns an empty 500 when D1 rejects the insert', async () => {
    const database = {
      prepare() {
        return { bind: () => ({ run: async () => { throw new Error('D1 unavailable') } }) }
      },
    }
    const response = await worker.fetch(post(JSON.stringify(validEvent)), environment(database))
    assert.equal(response.status, 500)
    assert.equal(await response.text(), '')
  })
})
