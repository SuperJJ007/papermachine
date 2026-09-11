/** Bounded, credential-redacting Host stderr persistence. */
import { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MAX_HOST_LOG_ROTATED_FILES } from './host-config.ts'

/** Persisted, bounded stderr destination for one Host command. */
export interface HostStderrLog {
  /** Exact `<dshHome>/logs/host.log` path. */
  readonly path: string
  /** Maximum bytes retained in the active file. */
  readonly maxBytes: number
  /** Number of numbered rotated files retained beside the active file. */
  readonly maxRotatedFiles: number
}

const SENSITIVE_ENV_NAME = /(credential|key|password|secret|token)/i
const REDACTED = '[REDACTED]'
const OVERSIZED_LINE = '[host stderr line omitted: exceeded configured logMaxBytes]\n'
/** Return an errno match without weakening unknown caught values. */
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null
    && (error as { readonly code?: unknown }).code === code
}

/** Replace credentials before any Host stderr bytes enter persistent storage. */
export function redactHostStderr(text: string, env: NodeJS.ProcessEnv): string {
  let redacted = text
  const exactValues = Object.entries(env)
    .filter(([name, value]) => SENSITIVE_ENV_NAME.test(name) && typeof value === 'string' && value.length > 0)
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length)
  for (const value of exactValues) redacted = redacted.replaceAll(value, REDACTED)
  return redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/(\b(?:api[_-]?key|authorization|credential|password|secret|token)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, `$1${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
}

/** Require a regular non-symlink log file, returning its byte size when present. */
async function regularFileSize(path: string): Promise<number | undefined> {
  try {
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`desktop host: log path ${JSON.stringify(path)} must be a regular file`)
    }
    return entry.size
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined
    throw error
  }
}

/** Remove one exact old rotation without following a symlink. */
async function removeRotationTarget(path: string): Promise<void> {
  try {
    const entry = await lstat(path)
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      throw new Error(`desktop host: rotated log path ${JSON.stringify(path)} must not be a directory`)
    }
    await unlink(path)
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error
  }
}

/** Rename one present regular log without accepting a link-shaped source. */
async function rotateIfPresent(source: string, target: string): Promise<void> {
  const size = await regularFileSize(source)
  if (size === undefined) return
  await rename(source, target)
}

/** Serialized writer that keeps the active and numbered Host logs within their configured byte/count bounds. */
export class RotatingHostLog {
  private queue: Promise<void> = Promise.resolve()
  private activeBytes: number | undefined

  constructor(
    private readonly config: HostStderrLog,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  /** Largest raw line retained for redaction; larger lines become a fixed diagnostic. */
  get lineBufferMaxBytes(): number {
    return this.config.maxBytes
  }

  /** Queue one complete stderr line after credential redaction. */
  write(line: string): void {
    const safe = Buffer.byteLength(line) > this.config.maxBytes
      ? OVERSIZED_LINE
      : redactHostStderr(line, this.env)
    this.queue = this.queue.then(async () => { await this.append(Buffer.from(safe)) })
    // The supervisor observes the same rejection through `flush`; this
    // handler only prevents an early queue rejection from becoming unhandled.
    this.queue.catch(() => {})
  }

  /** Resolve after every queued write closes its file handle. */
  flush(): Promise<void> {
    return this.queue
  }

  /** Create and validate the private log directory and active file state once. */
  private async prepare(): Promise<void> {
    if (this.activeBytes !== undefined) return
    const directory = dirname(this.config.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const entry = await lstat(directory)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`desktop host: log directory ${JSON.stringify(directory)} must be a private directory`)
    }
    await chmod(directory, 0o700)
    for (let index = this.config.maxRotatedFiles + 1; index <= MAX_HOST_LOG_ROTATED_FILES; index += 1) {
      await removeRotationTarget(`${this.config.path}.${String(index)}`)
    }
    this.activeBytes = await regularFileSize(this.config.path) ?? 0
    if (this.activeBytes >= this.config.maxBytes) await this.rotate()
  }

  /** Move the active file through the configured numbered retention set. */
  private async rotate(): Promise<void> {
    for (let index = this.config.maxRotatedFiles; index >= 1; index -= 1) {
      const target = `${this.config.path}.${String(index)}`
      const source = index === 1 ? this.config.path : `${this.config.path}.${String(index - 1)}`
      await removeRotationTarget(target)
      await rotateIfPresent(source, target)
    }
    this.activeBytes = 0
  }

  /** Append one already-redacted line without splitting it across rotations. */
  private async append(data: Buffer): Promise<void> {
    await this.prepare()
    if ((this.activeBytes as number) > 0 && (this.activeBytes as number) + data.byteLength > this.config.maxBytes) {
      await this.rotate()
    }
    const handle = await open(
      this.config.path,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      const entry = await handle.stat()
      if (!entry.isFile()) throw new Error(`desktop host: log path ${JSON.stringify(this.config.path)} must be a regular file`)
      await handle.chmod(0o600)
      await handle.writeFile(data)
    } finally {
      await handle.close()
    }
    this.activeBytes = (this.activeBytes as number) + data.byteLength
  }
}

/** Drain Host stderr by complete bounded lines so credentials split across stream chunks are still redacted. */
export function drainHostStderr(child: Pick<ChildProcess, 'stderr'>, log: RotatingHostLog): Promise<void> {
  const stderr = child.stderr
  if (stderr === null) return Promise.reject(new Error('desktop host: stderr pipe is unavailable'))
  stderr.setEncoding('utf8')
  return new Promise<void>((resolve, reject) => {
    let buffered = ''
    let discardingOversizedLine = false
    let finished = false
    const finish = (error?: Error): void => {
      if (finished) return
      finished = true
      if (!discardingOversizedLine && buffered.length > 0) log.write(buffered)
      void log.flush().then(
        () => {
          if (error === undefined) resolve()
          else reject(error)
        },
        reject,
      )
    }
    stderr.on('data', (incoming: string) => {
      let chunk = incoming
      if (discardingOversizedLine) {
        const newline = chunk.indexOf('\n')
        if (newline === -1) return
        chunk = chunk.slice(newline + 1)
        discardingOversizedLine = false
      }
      buffered += chunk
      while (true) {
        const newline = buffered.indexOf('\n')
        if (newline === -1) break
        log.write(buffered.slice(0, newline + 1))
        buffered = buffered.slice(newline + 1)
      }
      if (Buffer.byteLength(buffered) > log.lineBufferMaxBytes) {
        log.write(OVERSIZED_LINE)
        buffered = ''
        discardingOversizedLine = true
      }
    })
    stderr.once('end', () => { finish() })
    stderr.once('error', (error) => { finish(new Error('desktop host: stderr pipe failed', { cause: error })) })
  })
}
