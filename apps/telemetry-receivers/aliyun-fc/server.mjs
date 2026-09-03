/** Alibaba Cloud Function Compute web-function receiver. */

import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { MAX_BODY_BYTES, parseTelemetryEvent } from '../shared/telemetry-event.mjs'

function emptyResponse(response, status, headers = undefined) {
  response.writeHead(status, headers)
  response.end()
}

function readLimitedBody(request) {
  const declaredLength = Number(request.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    request.resume()
    return Promise.resolve(undefined)
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    let byteLength = 0
    let settled = false
    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
    }
    const onData = (chunk) => {
      byteLength += chunk.length
      if (byteLength > MAX_BODY_BYTES) {
        settled = true
        chunks.length = 0
        cleanup()
        request.resume()
        resolve(undefined)
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks, byteLength))
    }
    const onError = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
  })
}

/**
 * Create the dependency-free HTTP server used by the Function Compute web function.
 * @param {{ log?: (line: string) => void }} [options] - Optional line sink used by tests; production writes to stdout.
 * @returns {http.Server} A server that has not started listening yet.
 */
export function createTelemetryServer(options = {}) {
  const log = options.log ?? console.log
  return http.createServer(async (request, response) => {
    if (request.method !== 'POST') {
      request.resume()
      emptyResponse(response, 405, { allow: 'POST' })
      return
    }

    let bodyBytes
    try {
      bodyBytes = await readLimitedBody(request)
    } catch {
      emptyResponse(response, 400)
      return
    }
    if (bodyBytes === undefined) {
      emptyResponse(response, 413)
      return
    }
    const event = parseTelemetryEvent(bodyBytes)
    if (event === undefined) {
      emptyResponse(response, 400)
      return
    }

    // SLS queries deduplicate by eventId. This receiver deliberately keeps no
    // in-memory dedupe state because Function Compute instances are ephemeral.
    log(JSON.stringify(event))
    emptyResponse(response, 204)
  })
}

/**
 * Resolve the listening port from `FC_SERVER_PORT`, the Function Compute
 * web-function convention for a configurable port, defaulting to `9000`
 * (Function Compute's own documented example and API default).
 * @param {string | undefined} rawPort - `process.env.FC_SERVER_PORT`.
 * @returns {number} The port to listen on.
 * @throws when `rawPort` is set but does not parse to an integer.
 */
export function resolveServerPort(rawPort) {
  const port = Number(rawPort ?? 9000)
  if (!Number.isInteger(port)) {
    throw new Error(`telemetry-receivers: FC_SERVER_PORT must be an integer, got ${JSON.stringify(rawPort)}`)
  }
  return port
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  createTelemetryServer().listen(resolveServerPort(process.env.FC_SERVER_PORT), '0.0.0.0')
}
