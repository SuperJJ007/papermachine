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

/** Candidates whose prefix falls under `root` — this machine's own `/opt/miniconda3` etc. would otherwise leak into assertions. */
function under(candidates: readonly { readonly prefix: string }[], root: string): readonly { readonly prefix: string }[] {
  return candidates.filter(candidate => candidate.prefix.startsWith(root))
}

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
})

describe('detectCondaEnvironments', () => {
  it('finds a conventional-root environment with both interpreters and probes their versions', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.9')
    await writeExecutable(join(prefix, 'bin', 'Rscript'), 'R version 4.5.3 (2026-03-11)')

    const candidates = under(await detectCondaEnvironments({ home }), home)
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

    const candidates = under(await detectCondaEnvironments({ home }), home)
    const prefixes = candidates.map(candidate => candidate.prefix).sort()
    expect(prefixes).toEqual([await realpath(base), await realpath(named)].sort())
  })

  it('rejects a python-only directory missing conda-meta/history', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.0')

    expect(under(await detectCondaEnvironments({ home }), home)).toEqual([])
  })

  it('reports a candidate without a version when its interpreter probe fails', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    // Present but not executable: the file-existence qualification check
    // still passes, but the `--version` probe fails and is swallowed.
    await writeFile(join(prefix, 'bin', 'python'), 'not a real interpreter')

    const candidates = under(await detectCondaEnvironments({ home }), home)
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

    const candidates = under(await detectCondaEnvironments({ home }), home)
    expect(candidates).toEqual([{ prefix: await realpath(custom), pythonVersion: 'Python 3.13.0' }])
  })

  it('ignores a missing ~/.conda/environments.txt', async () => {
    const home = await makeHome()
    await expect(detectCondaEnvironments({ home })).resolves.toBeDefined()
  })

  it('dedupes a prefix reachable through both the root scan and environments.txt', async () => {
    const home = await makeHome()
    const prefix = join(home, 'miniconda3')
    await makeCondaMeta(prefix)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeExecutable(join(prefix, 'bin', 'python'), 'Python 3.11.9')
    await mkdir(join(home, '.conda'), { recursive: true })
    await writeFile(join(home, '.conda', 'environments.txt'), `${prefix}\n`)

    expect(under(await detectCondaEnvironments({ home }), home)).toHaveLength(1)
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

    expect(under(await detectCondaEnvironments({ home }), home)).toHaveLength(1)
  })
})
