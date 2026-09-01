/**
 * Desktop-owned record of the last port the Host successfully bound, read
 * back on the next launch so the carrier can request the same port instead
 * of a fresh OS-assigned one — keeping the BrowserWindow's origin, and
 * therefore browser-side `localStorage` state keyed by it, stable across
 * ordinary launches. See `host-launch.ts` for how the remembered port is
 * used and re-recorded.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'

/** The persisted record: the port the Host most recently reported binding to. */
export interface HostPortRecord {
  readonly port: number
}

const FIELDS = ['port'] as const

function hostPortRecordPath(dshHome: string): string {
  return join(dshHome, 'host-port.json')
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}

/**
 * Parse an untrusted JSON value into a {@link HostPortRecord}.
 * @param value - the parsed JSON content of `host-port.json`.
 * @throws when a field is missing, has the wrong shape, or the port is out of range.
 */
export function parseHostPortRecord(value: unknown): HostPortRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop host port: must be a record')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(FIELDS as readonly string[]).includes(key)) throw new Error(`desktop host port: unknown field ${key}`)
  }
  if (!isValidPort(record.port)) throw new Error('desktop host port: port must be an integer between 1 and 65535')
  return { port: record.port }
}

/**
 * Read the last port the Host successfully bound. Never throws, unlike this
 * application's other pointer-file readers (`environment-binding.ts`,
 * `custom-environment.ts`): those guard a correctness fact — binding to a
 * prefix that no longer qualifies must fail loud rather than silently run
 * against the wrong environment. This record guards only an optimization
 * (holding the BrowserWindow's origin stable across launches), so a missing,
 * unreadable, or corrupt file degrades the same way a taken port does — to
 * an OS-assigned port on this launch — rather than blocking or failing it.
 * @param dshHome - the Harness home the record is scoped to.
 * @returns the remembered port, or `undefined` when none is recorded or trustworthy.
 */
export async function readRememberedHostPort(dshHome: string): Promise<number | undefined> {
  try {
    return parseHostPortRecord(JSON.parse(await readFile(hostPortRecordPath(dshHome), 'utf8'))).port
  } catch {
    // Missing (ordinary first launch), unreadable, or corrupt: every case
    // reaches here and degrades to requesting an OS-assigned port on this
    // launch via the `undefined` return.
    return undefined
  }
}

/**
 * Persist the port the Host actually reported after a successful launch.
 * Never throws: an otherwise-successful launch must not fail because this
 * bookkeeping write did, so a write failure here only costs the next
 * launch its port stability, not this launch's success.
 * @param dshHome - the Harness home the record is scoped to.
 * @param port - the port the Host reported binding to.
 */
export async function writeRememberedHostPort(dshHome: string, port: number): Promise<void> {
  try {
    await writeFileAtomic(hostPortRecordPath(dshHome), `${JSON.stringify({ port } satisfies HostPortRecord)}\n`, { mode: 0o600 })
  } catch (error) {
    console.error('desktop host port: failed to remember bound port', error)
  }
}
