/** Private scratch marker, mode, resume, and path-ownership behavior. */

import {
  chmodSync,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  openSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import {
  createKernelScratch,
  createProbeScratch,
  createRunScratch,
  canonicalWithin,
  ensureSessionScratch,
  materializeSessionScratch,
  planKernelScratch,
  removeProbeScratch,
  removeUnpublishedRunScratch,
  rollbackSessionScratch,
  requireExecutable,
  scienceSessionScratchRoot,
  sessionScratchKey,
} from '../src/scratch.ts'

const fsFault = vi.hoisted(() => ({
  mkdir: '', mkdirError: undefined as unknown, lstat: '', lstatError: undefined as unknown,
  lstatRemaining: Number.POSITIVE_INFINITY, rm: '', rmError: undefined as unknown,
  ownerOpen: '', ownerOpenCalls: 0, ownerOpenError: undefined as unknown,
  ownerOpenReady: undefined as undefined | { readonly promise: Promise<undefined>; resolve(value: undefined): void },
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    mkdir: async (path: Parameters<typeof original.mkdir>[0], options?: Parameters<typeof original.mkdir>[1]) => {
      if (path === fsFault.mkdir) throw fsFault.mkdirError
      return original.mkdir(path, options)
    },
    lstat: async (path: Parameters<typeof original.lstat>[0], options?: Parameters<typeof original.lstat>[1]) => {
      if (path === fsFault.lstat && fsFault.lstatRemaining > 0) {
        fsFault.lstatRemaining -= 1
        throw fsFault.lstatError
      }
      return original.lstat(path, options as never)
    },
    rm: async (path: Parameters<typeof original.rm>[0], options?: Parameters<typeof original.rm>[1]) => {
      if (path === fsFault.rm) throw fsFault.rmError
      return original.rm(path, options)
    },
    open: async (
      path: Parameters<typeof original.open>[0],
      flags: Parameters<typeof original.open>[1],
      mode?: Parameters<typeof original.open>[2],
    ) => {
      if (path === fsFault.ownerOpen && fsFault.ownerOpenError !== undefined) throw fsFault.ownerOpenError
      if (path === fsFault.ownerOpen && flags === 'wx') {
        fsFault.ownerOpenCalls += 1
        if (fsFault.ownerOpenCalls === 2) fsFault.ownerOpenReady?.resolve(undefined)
        await fsFault.ownerOpenReady?.promise
      }
      return original.open(path, flags, mode)
    },
  }
})

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  fsFault.mkdir = ''
  fsFault.mkdirError = undefined
  fsFault.lstat = ''
  fsFault.lstatError = undefined
  fsFault.lstatRemaining = Number.POSITIVE_INFINITY
  fsFault.rm = ''
  fsFault.rmError = undefined
  fsFault.ownerOpen = ''
  fsFault.ownerOpenCalls = 0
  fsFault.ownerOpenError = undefined
  fsFault.ownerOpenReady = undefined
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Create an otherwise minimal durable Session for a private-scratch operation. */
async function sessionWithId(id: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  return ctx.sessions.create(SessionId(id))
}

/** Assert a managed directory uses the exact private POSIX mode. */
function expectPrivateDirectory(path: string): void {
  const entry = lstatSync(path)
  expect(entry.isDirectory()).toBe(true)
  expect(entry.isSymbolicLink()).toBe(false)
  expect(entry.mode & 0o777).toBe(0o700)
}

/** Assert a managed regular file uses the exact private POSIX mode. */
function expectPrivateFile(path: string): void {
  const entry = lstatSync(path)
  expect(entry.isFile()).toBe(true)
  expect(entry.isSymbolicLink()).toBe(false)
  expect(entry.mode & 0o777).toBe(0o600)
}

describe('Science Runtime private scratch', () => {
  it('creates mode-private marker and Session paths, resumes a same-ID Session, and separates a fork', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-scratch-'))
    roots.push(root)
    const dshHome = join(root, 'science home with space')
    const original = await sessionWithId('science-scratch-resume')
    const scratch = await ensureSessionScratch(dshHome, original)
    const key = sessionScratchKey(original)
    const marker = join(dshHome, 'science', 'v1', 'owners', `${key}.json`)

    expect(readFileSync(marker, 'utf8')).toBe(JSON.stringify({
      version: 1, key, sessionId: 'science-scratch-resume',
    }))
    for (const path of [scratch.root, scratch.home, scratch.state, scratch.runs, scratch.probes, scratch.kernels]) {
      expectPrivateDirectory(path)
    }
    expectPrivateFile(marker)

    const resumed = await sessionWithId('science-scratch-resume')
    expect(await ensureSessionScratch(dshHome, resumed)).toEqual(scratch)
    const fork = await sessionWithId('science-scratch-fork')
    const forkScratch = await ensureSessionScratch(dshHome, fork)
    expect(forkScratch.root).not.toBe(scratch.root)
    expectPrivateDirectory(forkScratch.root)
  })

  it('recovers an exact marker-only crash point but fails closed for collisions or a root without its marker', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-owner-'))
    roots.push(root)
    const dshHome = join(root, 'dsh-home')
    const session = await sessionWithId('science-owner-collision')
    const scratch = await ensureSessionScratch(dshHome, session)
    const marker = join(dshHome, 'science', 'v1', 'owners', `${sessionScratchKey(session)}.json`)

    writeFileSync(marker, JSON.stringify({ version: 1, key: 'wrong', sessionId: 'other' }))
    chmodSync(marker, 0o600)
    await expect(ensureSessionScratch(dshHome, session)).rejects.toThrow(/owner marker does not match/)

    writeFileSync(marker, JSON.stringify({ version: 1, key: sessionScratchKey(session), sessionId: String(session.id) }))
    chmodSync(marker, 0o600)
    rmSync(scratch.root, { recursive: true })
    const recovered = await ensureSessionScratch(dshHome, session)
    expect(recovered.root).toBe(scratch.root)
    expectPrivateDirectory(recovered.root)

    unlinkSync(marker)
    await expect(ensureSessionScratch(dshHome, session)).rejects.toThrow(/must appear together/)
    expectPrivateDirectory(scratch.root)
  })

  it('refuses to roll back ownership whose exact marker changed after materialization', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-owner-rollback-'))
    roots.push(root)
    const preparation = await materializeSessionScratch(
      join(root, 'dsh-home'),
      await sessionWithId('science-owner-rollback'),
    )
    writeFileSync(preparation.marker, JSON.stringify({ version: 1, key: 'changed', sessionId: 'changed' }))
    chmodSync(preparation.marker, 0o600)
    await expect(rollbackSessionScratch(preparation)).rejects.toThrow(/owner marker changed/)
    expectPrivateDirectory(preparation.scratch.root)
  })

  it('rolls back a new exact marker when Session scratch materialization fails midway', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-owner-partial-'))
    roots.push(root)
    const dshHome = join(root, 'dsh-home')
    const session = await sessionWithId('science-owner-partial')
    const scratchRoot = await scienceSessionScratchRoot(dshHome, session)
    const marker = join(dshHome, 'science', 'v1', 'owners', `${sessionScratchKey(session)}.json`)
    fsFault.mkdir = scratchRoot
    fsFault.mkdirError = Object.assign(new Error('injected root creation failure'), { code: 'EACCES' })
    await expect(materializeSessionScratch(dshHome, session)).rejects.toThrow(/root creation failure/)
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(scratchRoot)).toBe(false)
  })

  it('aggregates materialization and exact-marker rollback failures', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-owner-partial-rollback-'))
    roots.push(root)
    const dshHome = join(root, 'dsh-home')
    const session = await sessionWithId('science-owner-partial-rollback')
    const scratchRoot = await scienceSessionScratchRoot(dshHome, session)
    const marker = join(dshHome, 'science', 'v1', 'owners', `${sessionScratchKey(session)}.json`)
    fsFault.mkdir = scratchRoot
    fsFault.mkdirError = Object.assign(new Error('injected root creation failure'), { code: 'EACCES' })
    fsFault.rm = marker
    fsFault.rmError = Object.assign(new Error('injected marker rollback failure'), { code: 'EACCES' })
    await expect(materializeSessionScratch(dshHome, session)).rejects.toThrow(/incomplete Session scratch rollback failed/)
  })

  it('refuses rollback when a newly owned root loses its exact marker', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-owner-marker-loss-'))
    roots.push(root)
    const preparation = await materializeSessionScratch(
      join(root, 'dsh-home'),
      await sessionWithId('science-owner-marker-loss'),
    )
    unlinkSync(preparation.marker)
    await expect(rollbackSessionScratch(preparation)).rejects.toThrow(/owner marker disappeared/)
    expectPrivateDirectory(preparation.scratch.root)
  })

  it('grants rollback ownership only to the concurrent materialization that wins exclusive marker creation', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-owner-race-'))
    roots.push(root)
    const dshHome = join(root, 'dsh-home')
    const firstSession = await sessionWithId('science-owner-race')
    const secondSession = await sessionWithId('science-owner-race')
    const marker = join(dshHome, 'science', 'v1', 'owners', `${sessionScratchKey(firstSession)}.json`)
    fsFault.ownerOpen = marker
    fsFault.ownerOpenReady = Promise.withResolvers<undefined>()
    const preparations = await Promise.all([
      materializeSessionScratch(dshHome, firstSession),
      materializeSessionScratch(dshHome, secondSession),
    ])
    expect(preparations.map(preparation => preparation.created).sort()).toEqual([false, true])
    const owner = preparations.find(preparation => preparation.created)
    const reuser = preparations.find(preparation => !preparation.created)
    if (owner === undefined || reuser === undefined) throw new Error('concurrent ownership receipt was not unique')
    await rollbackSessionScratch(reuser)
    expectPrivateFile(marker)
    expectPrivateDirectory(owner.scratch.root)
    await rollbackSessionScratch(owner)
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(owner.scratch.root)).toBe(false)
    await expect(rollbackSessionScratch(owner)).resolves.toBeUndefined()
  })

  it('preserves non-collision marker creation errors and rejects a raced mismatched marker', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-owner-race-errors-'))
    roots.push(root)
    const dshHome = join(root, 'dsh-home')
    const createFailureSession = await sessionWithId('science-owner-create-failure')
    const createFailureMarker = join(dshHome, 'science', 'v1', 'owners', `${sessionScratchKey(createFailureSession)}.json`)
    fsFault.ownerOpen = createFailureMarker
    fsFault.ownerOpenError = Object.assign(new Error('injected exclusive owner open failure'), { code: 'EACCES' })
    await expect(materializeSessionScratch(dshHome, createFailureSession)).rejects.toThrow(/exclusive owner open failure/)

    fsFault.ownerOpen = ''
    fsFault.ownerOpenError = undefined
    const mismatchSession = await sessionWithId('science-owner-raced-mismatch')
    const mismatchMarker = join(dshHome, 'science', 'v1', 'owners', `${sessionScratchKey(mismatchSession)}.json`)
    mkdirSync(join(dshHome, 'science', 'v1', 'owners'), { recursive: true, mode: 0o700 })
    writeFileSync(mismatchMarker, JSON.stringify({ version: 1, key: 'wrong', sessionId: 'wrong' }))
    chmodSync(mismatchMarker, 0o600)
    fsFault.lstat = mismatchMarker
    fsFault.lstatError = Object.assign(new Error('injected first-observation absence'), { code: 'ENOENT' })
    fsFault.lstatRemaining = 1
    await expect(materializeSessionScratch(dshHome, mismatchSession)).rejects.toThrow(/concurrently created owner marker does not match/)
  })

  it('rejects an unexpected symlink and writes exact private source bytes for a retained run', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-source-'))
    roots.push(root)
    const dshHome = join(root, 'dsh-home')
    const session = await sessionWithId('science-source-ownership')
    const scratch = await ensureSessionScratch(dshHome, session)
    const bytes = Buffer.from('print("运行-✓")\n', 'utf8')
    const run = await createRunScratch(
      scratch,
      ScienceRunId('00000000-0000-4000-8000-000000000001'),
      'python',
      bytes,
    )

    expect(readFileSync(run.source)).toEqual(bytes)
    expectPrivateDirectory(run.directory)
    expectPrivateDirectory(run.artifacts)
    expectPrivateFile(run.source)

    rmSync(scratch.home, { recursive: true })
    const foreign = join(root, 'foreign-home')
    mkdirSync(foreign, { mode: 0o700 })
    symlinkSync(foreign, scratch.home)
    await expect(ensureSessionScratch(dshHome, session)).rejects.toThrow(/private directory/)
  })

  it('plans and creates a private kernel directory named by language and index', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-kernel-scratch-'))
    roots.push(root)
    const session = await sessionWithId('science-kernel-scratch')
    const scratch = await ensureSessionScratch(join(root, 'dsh-home'), session)

    const planned = planKernelScratch(scratch, 'python', 0)
    expect(planned.ref).toBe('kernels/python-0/')
    expect(planned.directory).toBe(join(scratch.kernels, 'python-0'))
    expect(planned.tmp).toBe(join(planned.directory, 'tmp'))

    const created = await createKernelScratch(scratch, planned)
    expect(created).toEqual(planned)
    expectPrivateDirectory(created.directory)
    expectPrivateDirectory(created.tmp)

    const second = await createKernelScratch(scratch, planKernelScratch(scratch, 'r', 1))
    expect(second.directory).toBe(join(scratch.kernels, 'r-1'))
    expectPrivateDirectory(second.directory)
  })

  it('rejects escaping cleanup paths and invalid configured executables', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-scratch-errors-'))
    roots.push(root)
    const session = await sessionWithId('science-scratch-errors')
    const scratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    await expect(createProbeScratch(scratch, {
      directory: scratch.probes,
      home: join(scratch.probes, 'home'),
      tmp: join(scratch.probes, 'tmp'),
    })).rejects.toThrow(/planned probe paths escape/)
    const probe = await createProbeScratch(scratch)
    await expect(removeProbeScratch(scratch, { ...probe, directory: scratch.probes })).rejects.toThrow(/escapes/)
    const run = await createRunScratch(scratch, ScienceRunId('00000000-0000-4000-8000-000000000002'), 'r', Buffer.from('x'))
    await expect(removeUnpublishedRunScratch(scratch, { ...run, directory: scratch.runs })).rejects.toThrow(/escapes/)
    await expect(createKernelScratch(scratch, {
      ref: 'kernels/python-0/', directory: scratch.kernels, tmp: join(scratch.kernels, 'tmp'),
    })).rejects.toThrow(/escape/)
    const outside = join(root, 'outside')
    writeFileSync(outside, 'outside')
    await expect(canonicalWithin(join(root, 'dsh-home'), outside)).rejects.toThrow(/escapes/)
    await expect(canonicalWithin(root, outside)).resolves.toBe(outside)
    const regular = join(root, 'regular')
    writeFileSync(regular, 'x')
    await expect(requireExecutable(regular)).rejects.toThrow(/not executable/)
    chmodSync(regular, 0o700)
    await expect(requireExecutable(regular)).resolves.toBeUndefined()
    const link = join(root, 'link')
    symlinkSync(regular, link)
    await expect(requireExecutable(link)).rejects.toThrow(/regular file/)
    await expect(createRunScratch(scratch, ScienceRunId('../escape'), 'python', Buffer.from('x'))).rejects.toThrow(/escapes/)
    const rollback = await createRunScratch(scratch, ScienceRunId('00000000-0000-4000-8000-000000000003'), 'python', Buffer.from('x'))
    await removeUnpublishedRunScratch(scratch, rollback)
    expect(existsSync(rollback.directory)).toBe(false)
  })

  it('fails closed for non-private managed marker and directory entries', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-scratch-private-'))
    roots.push(root)
    const dshHome = join(root, 'dsh-home')
    const session = await sessionWithId('science-scratch-private')
    const scratch = await ensureSessionScratch(dshHome, session)
    const marker = join(dshHome, 'science', 'v1', 'owners', `${sessionScratchKey(session)}.json`)
    chmodSync(marker, 0o644)
    await expect(ensureSessionScratch(dshHome, session)).rejects.toThrow(/not private/)
    chmodSync(marker, 0o600)
    chmodSync(scratch.home, 0o755)
    await expect(ensureSessionScratch(dshHome, session)).rejects.toThrow(/not private/)
    chmodSync(scratch.home, 0o700)
    unlinkSync(marker)
    symlinkSync(join(root, 'outside-marker'), marker)
    await expect(ensureSessionScratch(dshHome, session)).rejects.toThrow(/regular file/)

    unlinkSync(marker)
    writeFileSync(marker, JSON.stringify({ version: 1, key: sessionScratchKey(session), sessionId: String(session.id) }))
    chmodSync(marker, 0o600)
    rmSync(scratch.state, { recursive: true })
    writeFileSync(scratch.state, 'not a directory')
    await expect(ensureSessionScratch(dshHome, session)).rejects.toThrow(/private directory/)

    const permissionRoot = mkdtempSync(join(process.cwd(), '.science-runtime-scratch-permission-'))
    roots.push(permissionRoot)
    const permissionHome = join(permissionRoot, 'dsh-home')
    await ensureSessionScratch(permissionHome, await sessionWithId('science-scratch-permission-first'))
    const science = join(permissionHome, 'science')
    const descriptor = openSync(science, 'r')
    try {
      fchmodSync(descriptor, 0o000)
      await expect(ensureSessionScratch(permissionHome, await sessionWithId('science-scratch-permission-second'))).rejects.toThrow()
    } finally {
      fchmodSync(descriptor, 0o700)
    }

    const injectedHome = join(root, 'injected-home')
    mkdirSync(join(injectedHome, 'science'), { recursive: true, mode: 0o700 })
    fsFault.mkdir = join(injectedHome, 'science')
    fsFault.mkdirError = Object.assign(new Error('existing private directory'), { code: 'EEXIST' })
    await expect(ensureSessionScratch(injectedHome, await sessionWithId('science-scratch-eexist'))).resolves.toBeDefined()
    fsFault.mkdir = join(injectedHome, 'science', 'v1')
    fsFault.mkdirError = Object.assign(new Error('injected mkdir access failure'), { code: 'EACCES' })
    await expect(ensureSessionScratch(injectedHome, await sessionWithId('science-scratch-mkdir-failure'))).rejects.toThrow(/mkdir access failure/)

    const markerSession = await sessionWithId('science-scratch-lstat-failure')
    const markerHome = join(root, 'marker-home')
    const markerPath = join(markerHome, 'science', 'v1', 'owners', `${sessionScratchKey(markerSession)}.json`)
    fsFault.mkdir = ''
    fsFault.lstat = markerPath
    fsFault.lstatError = Object.assign(new Error('injected marker access failure'), { code: 'EACCES' })
    await expect(ensureSessionScratch(markerHome, markerSession)).rejects.toThrow(/marker access failure/)
    fsFault.lstatError = 'injected non-Error marker failure'
    await expect(ensureSessionScratch(markerHome, markerSession)).rejects.toBe('injected non-Error marker failure')
  })

  it('removes only a quiescent provider-owned probe and rejects a generic-temp scratch root', async () => {
    const root = mkdtempSync(join(process.cwd(), '.science-runtime-probe-'))
    roots.push(root)
    const session = await sessionWithId('science-probe-cleanup')
    const scratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
    const probe = await createProbeScratch(scratch)
    expectPrivateDirectory(probe.directory)
    await removeProbeScratch(scratch, probe)
    expect(existsSync(probe.directory)).toBe(false)
    expectPrivateDirectory(scratch.home)

    const tempSession = await sessionWithId('science-temp-root')
    await expect(scienceSessionScratchRoot(join('/tmp', 'science-runtime-negative'), tempSession))
      .rejects.toThrow(/must not overlap/)

    const blockedHome = join(root, 'blocked-home')
    writeFileSync(blockedHome, 'not a directory')
    await expect(ensureSessionScratch(blockedHome, await sessionWithId('science-blocked-home')))
      .rejects.toThrow()
  })

})
