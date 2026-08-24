import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectCondaEnvironments, qualifyingInterpreters } from '../src/detection.ts'

/** Write an executable shell script at `path` that prints `output` to stdout and exits 0. */
async function writeExecutable(path: string, output: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\necho "${output}"\n`)
  await chmod(path, 0o755)
}

// Realpath'd immediately: detectCondaEnvironments reports real paths, and on
// macOS mkdtemp's own path (under /var/folders/...) is itself a symlink into
// /private/var/folders/..., so an un-resolved `home` would never prefix-match.
async function makeHome(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'dsh-desktop-detect-home-')))
}

async function makeCondaMeta(prefix: string): Promise<void> {
  await mkdir(join(prefix, 'conda-meta'), { recursive: true })
  await writeFile(join(prefix, 'conda-meta', 'history'), '')
}

// This process's own uid (0 on a root-run CI agent), gating the two tests
// below that rely on a permission bit root ignores.
const isRoot = process.getuid?.() === 0

describe('qualifyingInterpreters', () => {
  it('rejects a prefix with no conda-meta/history', async () => {
    const home = await makeHome()
    const prefix = join(home, 'bare')
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.0')

    expect(await qualifyingInterpreters(prefix)).toBeUndefined()
  })

  it('rejects a prefix with conda-meta/history but neither interpreter', async () => {
    const home = await makeHome()
    const prefix = join(home, 'empty-env')
    await makeCondaMeta(prefix)

    expect(await qualifyingInterpreters(prefix)).toBeUndefined()
  })

  it('accepts a python-only environment', async () => {
    const home = await makeHome()
    const prefix = join(home, 'py-env')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.0')

    expect(await qualifyingInterpreters(prefix)).toEqual({ python: true, r: false })
  })

  it('accepts an r-only environment', async () => {
    const home = await makeHome()
    const prefix = join(home, 'r-env')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'Rscript'), 'R version 4.5.3')

    expect(await qualifyingInterpreters(prefix)).toEqual({ python: false, r: true })
  })

  it('reports undefined for a prefix that does not exist', async () => {
    expect(await qualifyingInterpreters('/does/not/exist/at-all')).toBeUndefined()
  })

  it('rejects a symlinked conda-meta/history, matching staticInterpreter', async () => {
    const home = await makeHome()
    const prefix = join(home, 'symlinked-history')
    await mkdir(join(prefix, 'conda-meta'), { recursive: true })
    const real = join(home, 'real-history-file')
    await writeFile(real, '')
    await symlink(real, join(prefix, 'conda-meta', 'history'))
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.0')

    expect(await qualifyingInterpreters(prefix)).toBeUndefined()
  })
})

describe('detectCondaEnvironments', () => {
  it('finds a conventional-root environment with both interpreters and probes their versions', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.9')
    await writeExecutable(join(prefix, 'bin', 'Rscript'), 'R version 4.5.3 (2026-03-11)')

    const candidates = await detectCondaEnvironments({ home, roots: [prefix] })
    const expectedPrefix = await realpath(prefix)
    expect(candidates).toEqual([{ prefix: expectedPrefix, pythonVersion: 'Python 3.11.9', rVersion: 'R version 4.5.3 (2026-03-11)' }])
  })

  it('finds environments under a conventional root\'s envs/ directory', async () => {
    const home = await makeHome()
    const base = join(home, 'anaconda3')
    const named = join(base, 'envs', 'my-project')
    await makeCondaMeta(base)
    await mkdir(join(base, 'bin'), { recursive: true })
    await writeExecutable(join(base, 'bin', 'python'), 'Python 3.10.0')
    await makeCondaMeta(named)
    await mkdir(join(named, 'bin'), { recursive: true })
    await writeExecutable(join(named, 'bin', 'python'), 'Python 3.12.1')

    const candidates = await detectCondaEnvironments({ home, roots: [base] })
    const prefixes = candidates.map(candidate => candidate.prefix).sort()
    expect(prefixes).toEqual([await realpath(base), await realpath(named)].sort())
  })

  it('finds a symlinked environment directory under envs/', async () => {
    const home = await makeHome()
    const base = join(home, 'anaconda3')
    const real = join(home, 'elsewhere', 'my-project')
    await mkdir(base, { recursive: true })
    await makeCondaMeta(real)
    await mkdir(join(real, 'bin'), { recursive: true })
    await writeExecutable(join(real, 'bin', 'python'), 'Python 3.12.1')
    await mkdir(join(base, 'envs'), { recursive: true })
    await symlink(real, join(base, 'envs', 'my-project'))

    const candidates = await detectCondaEnvironments({ home, roots: [base] })
    expect(candidates.map(candidate => candidate.prefix)).toEqual([await realpath(real)])
  })

  it('rejects a python-only directory missing conda-meta/history', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.0')

    expect(await detectCondaEnvironments({ home, roots: [prefix] })).toEqual([])
  })

  it('reports a candidate without a version when its interpreter probe fails', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    // Present but not executable: the file-existence qualification check
    // still passes, but the `--version` probe fails and is swallowed.
    await writeFile(join(prefix, 'bin', 'python'), 'not a real interpreter')

    const candidates = await detectCondaEnvironments({ home, roots: [prefix] })
    expect(candidates).toEqual([{ prefix: await realpath(prefix) }])
  })

  it('parses ~/.conda/environments.txt for prefixes outside any conventional root', async () => {
    const home = await makeHome()
    const custom = join(home, 'somewhere-else', 'my-env')
    await makeCondaMeta(custom)
    await mkdir(join(custom, 'bin'), { recursive: true })
    await writeExecutable(join(custom, 'bin', 'python'), 'Python 3.13.0')
    await mkdir(join(home, '.conda'), { recursive: true })
    await writeFile(join(home, '.conda', 'environments.txt'), `${custom}\n`)

    const candidates = await detectCondaEnvironments({ home, roots: [] })
    expect(candidates).toEqual([{ prefix: await realpath(custom), pythonVersion: 'Python 3.13.0' }])
  })

  it('ignores a missing ~/.conda/environments.txt', async () => {
    const home = await makeHome()
    await expect(detectCondaEnvironments({ home, roots: [] })).resolves.toEqual([])
  })

  it('dedupes a prefix reachable through both the root scan and environments.txt', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.9')
    await mkdir(join(home, '.conda'), { recursive: true })
    await writeFile(join(home, '.conda', 'environments.txt'), `${prefix}\n`)

    expect(await detectCondaEnvironments({ home, roots: [prefix] })).toHaveLength(1)
  })

  it('dedupes a symlinked duplicate by real path', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.9')
    const alias = join(home, 'somewhere-else-alias')
    await mkdir(join(home, 'somewhere-else-dir'), { recursive: true })
    await symlink(prefix, alias)
    await mkdir(join(home, '.conda'), { recursive: true })
    await writeFile(join(home, '.conda', 'environments.txt'), `${alias}\n`)

    expect(await detectCondaEnvironments({ home, roots: [prefix] })).toHaveLength(1)
  })

  // Per-candidate/root error isolation: a filesystem condition on one root or
  // candidate must drop only that item, never abort the rest of the scan.
  it.skipIf(isRoot)('skips a root directory it cannot read, without aborting the scan', async () => {
    const home = await makeHome()
    const unreadable = join(home, 'miniconda3')
    await mkdir(unreadable, { recursive: true })
    await chmod(unreadable, 0o000)
    try {
      await expect(detectCondaEnvironments({ home, roots: [unreadable] })).resolves.toEqual([])
    } finally {
      await chmod(unreadable, 0o755)
    }
  })

  it.skipIf(isRoot)('continues scanning past an unreadable root to a later good root', async () => {
    const home = await makeHome()
    const unreadable = join(home, 'miniconda3')
    await mkdir(unreadable, { recursive: true })
    await chmod(unreadable, 0o000)
    const good = join(home, 'anaconda3')
    await makeCondaMeta(good)
    await mkdir(join(good, 'bin'), { recursive: true })
    await writeExecutable(join(good, 'bin', 'python'), 'Python 3.11.0')
    try {
      const candidates = await detectCondaEnvironments({ home, roots: [unreadable, good] })
      expect(candidates).toEqual([{ prefix: await realpath(good), pythonVersion: 'Python 3.11.0' }])
    } finally {
      await chmod(unreadable, 0o755)
    }
  })

  it('skips a root that is a regular file, not a directory', async () => {
    const home = await makeHome()
    const fileRoot = join(home, 'micromamba')
    await writeFile(fileRoot, 'not a directory')

    await expect(detectCondaEnvironments({ home, roots: [fileRoot] })).resolves.toEqual([])
  })

  it.skipIf(isRoot)('skips an environments.txt prefix inside a parent it cannot read', async () => {
    const home = await makeHome()
    const parent = join(home, 'blocked')
    const prefix = join(parent, 'env')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.0')
    await mkdir(join(home, '.conda'), { recursive: true })
    await writeFile(join(home, '.conda', 'environments.txt'), `${prefix}\n`)
    await chmod(parent, 0o000)
    try {
      await expect(detectCondaEnvironments({ home, roots: [] })).resolves.toEqual([])
    } finally {
      await chmod(parent, 0o755)
    }
  })
})
