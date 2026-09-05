/**
 * `KernelProcess.start()` forced onto the loopback TCP transport
 * ({@link KernelProcessOptions.transportKind}), running the real shipped
 * driver assets (`assets/kernel_python.py`, `assets/kernel_r.R`) through the
 * full RUN → DONE → EXIT sequence over an actual `node:net` connection — the
 * one part of this Runtime a fake-prefix or fake-driver test cannot exercise,
 * since the real drivers are what call `socket.create_connection`/
 * `socketConnection` on the endpoint argv. `process.platform` is never
 * mocked: `transportKind: 'tcp'` selects the transport directly, so this
 * suite runs on this machine's real darwin/linux host while still proving
 * the transport the product only ever selects automatically on win32.
 *
 * Self-skips per language with a clear reason when no usable bound
 * interpreter exists: reads `pythonPrefix`/`rPrefix` from
 * `~/.papermachine/environment-binding.json` (the desktop app's own
 * environment-binding record) and locates the executable the way the
 * product itself does ({@link executableCandidate}'s per-platform layout),
 * falling back to a bare `python3`/`Rscript` (`.exe`-suffixed on win32)
 * resolved off this machine's PATH.
 */

import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import { ScienceRunId } from '@deepseek-ai/dsh-science-session'
import type { ScienceInterpreterAvailableBinding, ScienceLanguage } from '@deepseek-ai/dsh-science-session'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { executableCandidate } from '../src/environment.ts'
import { resolveKernelDriverPath, KERNEL_ASSETS_ROOT } from '../src/kernel-assets.ts'
import { KernelProcess } from '../src/kernel-process.ts'
import type { KernelExecuteRequest } from '../src/kernel-process.ts'
import { ensureSessionScratch } from '../src/scratch.ts'
import { createFakeSandboxRunner, TEST_KERNEL_START_TIMEOUT_MS } from './harness.ts'

interface EnvironmentBinding {
  readonly pythonPrefix?: string
  readonly rPrefix?: string
}

/** Read the desktop app's own environment-binding record, tolerating its total absence. */
function readEnvironmentBinding(): EnvironmentBinding {
  const path = join(homedir(), '.papermachine', 'environment-binding.json')
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EnvironmentBinding
  } catch {
    return {}
  }
}

const binding = readEnvironmentBinding()

/**
 * Walk upward from a resolved executable's directory to the nearest
 * ancestor that is itself a Conda prefix (carries `conda-meta/history`),
 * so a PATH-resolved Rscript works whether this build places it at
 * `Scripts\Rscript.exe` or `Lib\R\bin\x64\Rscript.exe` on win32. Falls back
 * to the fixed `<prefix>/bin/<executable>` shape for a plain, non-Conda
 * system interpreter, where no ancestor ever carries `conda-meta`.
 */
function deriveCanonicalPrefix(executable: string): string {
  let candidate = dirname(executable)
  let previous: string | undefined
  while (candidate !== previous) {
    if (existsSync(join(candidate, 'conda-meta', 'history'))) return candidate
    previous = candidate
    candidate = dirname(candidate)
  }
  return dirname(dirname(executable))
}

/** Find one language's bare command on this process's own PATH, tolerating total absence. */
function resolveOnPath(
  language: ScienceLanguage,
): { readonly executable: string; readonly canonicalPrefix: string } | undefined {
  const bareName = language === 'python' ? 'python3' : 'Rscript'
  const name = process.platform === 'win32' ? `${bareName}.exe` : bareName
  const path = process.env.PATH ?? ''
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return { executable: candidate, canonicalPrefix: deriveCanonicalPrefix(candidate) }
    } catch {
      // Try the next PATH directory; a final miss is reported by the caller.
    }
  }
  return undefined
}

/** Resolve one language's real usable interpreter for this machine, or a skip reason. */
function resolveRealInterpreter(
  language: ScienceLanguage,
): { readonly executable: string; readonly canonicalPrefix: string } | { readonly skip: string } {
  const boundPrefix = language === 'python' ? binding.pythonPrefix : binding.rPrefix
  if (boundPrefix !== undefined) {
    const boundExecutable = executableCandidate(language, boundPrefix)
    if (existsSync(boundExecutable)) return { executable: boundExecutable, canonicalPrefix: boundPrefix }
  }
  const resolved = resolveOnPath(language)
  if (resolved !== undefined) return resolved
  return {
    skip: `no usable ${language} interpreter: neither environment-binding.json's `
      + `${language === 'python' ? 'pythonPrefix' : 'rPrefix'} nor a PATH-resolved `
      + `${language === 'python' ? 'python3' : 'Rscript'} exists on this machine`,
  }
}

/** Fabricate an available binding around a real resolved interpreter; KernelProcess never re-validates it. */
function realBinding(language: ScienceLanguage, executable: string, canonicalPrefix: string): ScienceInterpreterAvailableBinding {
  return {
    language,
    configuredPrefix: canonicalPrefix,
    canonicalPrefix,
    executable,
    executableIdentity: 'real-interpreter-identity',
    languageVersion: 'real-1.0',
    condaHistorySha256: 'real-history-sha',
    bindingFingerprint: `real-binding-${language}`,
    packages: [],
    packagesSha256: 'real-packages-sha',
    packagesTruncated: false,
    capability: 'available',
  }
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Assemble real Session, subprocess-local, and sandbox-local providers (no-policy fake runner), mirroring `kernel-process.spec.ts`. */
async function createHarness(id: string) {
  const root = mkdtempSync(join(process.cwd(), '.science-runtime-kernel-tcp-real-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  const runner = createFakeSandboxRunner(root)
  await ctx.plugin(LocalSandboxProvider, {
    runnerCommand: [runner],
    runnerFailureSignatures: ['science-runtime fake runner failure'],
  })
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd: root } })
  const sessionScratch = await ensureSessionScratch(join(root, 'dsh-home'), session)
  return { root, session, services: { subprocess: ctx.subprocess, sandbox: ctx.sandbox, session, sessionScratch } }
}

/** Flush one real-source RUN request into private run scratch. */
async function prepareRealRun(root: string, runId: string, source: string): Promise<KernelExecuteRequest> {
  const dir = join(root, 'kernel-runs', runId)
  const artifactDir = join(dir, 'artifacts')
  await mkdir(artifactDir, { recursive: true })
  const sourcePath = join(dir, 'action.src')
  await writeFile(sourcePath, source)
  return {
    runId: ScienceRunId(runId),
    sourcePath,
    cwd: dir,
    stdoutPath: join(dir, 'stdout.txt'),
    stderrPath: join(dir, 'stderr.txt'),
    artifactDir,
    inputDir: join(dir, 'inputs'),
  }
}

const realPython = resolveRealInterpreter('python')
const realR = resolveRealInterpreter('r')

describe('KernelProcess over the loopback TCP transport (forced, real driver)', () => {
  it(
    'skip' in realPython
      ? `skips (no usable Python interpreter): ${realPython.skip}`
      : 'runs assets/kernel_python.py through RUN -> DONE -> EXIT over a real TCP connection',
    { skip: 'skip' in realPython, timeout: 30_000 },
    async () => {
      if ('skip' in realPython) return
      const resolved = realPython
      const harness = await createHarness('kernel-tcp-real-python')
      const kernel = await KernelProcess.start({
        services: harness.services,
        binding: realBinding('python', resolved.executable, resolved.canonicalPrefix),
        driverPath: resolveKernelDriverPath(KERNEL_ASSETS_ROOT, 'python'),
        index: 0,
        kernelStartTimeoutMs: TEST_KERNEL_START_TIMEOUT_MS,
        transportKind: 'tcp',
      })
      try {
        const request = await prepareRealRun(harness.root, 'run-tcp-python', 'print("dsh-tcp-transport-ok")\n')
        const result = await kernel.execute(request)
        expect(result).toMatchObject({ status: 'ok' })
        expect(await readFile(request.stdoutPath, 'utf8')).toBe('dsh-tcp-transport-ok\n')
      } finally {
        await expect(kernel.end('test-teardown')).resolves.toMatchObject({ quiescent: true })
      }
    },
  )

  it(
    'skip' in realR
      ? `skips (no usable R interpreter): ${realR.skip}`
      : 'runs assets/kernel_r.R through RUN -> DONE -> EXIT over a real TCP connection',
    { skip: 'skip' in realR, timeout: 30_000 },
    async () => {
      if ('skip' in realR) return
      const resolved = realR
      const harness = await createHarness('kernel-tcp-real-r')
      const kernel = await KernelProcess.start({
        services: harness.services,
        binding: realBinding('r', resolved.executable, resolved.canonicalPrefix),
        driverPath: resolveKernelDriverPath(KERNEL_ASSETS_ROOT, 'r'),
        index: 0,
        kernelStartTimeoutMs: TEST_KERNEL_START_TIMEOUT_MS,
        transportKind: 'tcp',
      })
      try {
        const request = await prepareRealRun(harness.root, 'run-tcp-r', 'cat("dsh-tcp-transport-ok\\n")\n')
        const result = await kernel.execute(request)
        expect(result).toMatchObject({ status: 'ok' })
        expect(await readFile(request.stdoutPath, 'utf8')).toBe('dsh-tcp-transport-ok\n')
      } finally {
        await expect(kernel.end('test-teardown')).resolves.toMatchObject({ quiescent: true })
      }
    },
  )
})
