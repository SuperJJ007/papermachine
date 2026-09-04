import { mkdir, mkdtemp, realpath, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HarnessHomeSpaceError, resolveHarnessHome } from '../src/harness-home.ts'

// Realpath'd immediately: on macOS mkdtemp's own path (under
// /var/folders/...) is itself a symlink into /private/var/folders/..., so an
// un-resolved `home` would never prefix-match the resolved Harness home.
async function makeHome(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'dsh-desktop-harness-home-')))
}

describe('resolveHarnessHome', () => {
  it('resolves a space-free, created directory under the given OS home directory', async () => {
    const home = await makeHome()

    const dshHome = await resolveHarnessHome(home)

    expect(dshHome).toBe(join(home, '.papermachine'))
    expect(dshHome.includes(' ')).toBe(false)
    expect((await stat(dshHome)).isDirectory()).toBe(true)
  })

  it('is idempotent: resolving twice against the same home succeeds and returns the same path', async () => {
    const home = await makeHome()

    const first = await resolveHarnessHome(home)
    const second = await resolveHarnessHome(home)

    expect(second).toBe(first)
  })

  it('rejects an OS home directory whose own path contains an ASCII space, without creating anything', async () => {
    const home = join(await makeHome(), 'a user')

    const error: unknown = await resolveHarnessHome(home).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(HarnessHomeSpaceError)
    expect((error as HarnessHomeSpaceError).path).toBe(join(home, '.papermachine'))
    await expect(stat(join(home, '.papermachine'))).rejects.toThrow()
  })

  it('rejects a space-free OS home directory that is itself a symlink into a space-containing target', async () => {
    // Science Runtime derives every kernel/probe scratch path from the
    // realpath-canonicalized Harness home (scratch.ts's rootForSession), so
    // a literal, space-free `osHomeDir` is not enough on its own: the real
    // target a symlink resolves to matters too. `realTarget` has a space;
    // `home` (the symlink) does not, so only the post-mkdir realpath check
    // — not the literal pre-check — can catch this.
    const root = await makeHome()
    const realTarget = join(root, 'a user')
    await mkdir(realTarget, { recursive: true })
    const home = join(root, 'home-link')
    await symlink(realTarget, home)

    const error: unknown = await resolveHarnessHome(home).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(HarnessHomeSpaceError)
    expect((error as HarnessHomeSpaceError).path).toBe(join(realTarget, '.papermachine'))
  })

  it('respects an explicit customHomeDir override when provided', async () => {
    const home = await makeHome()
    const custom = await makeHome()

    const dshHome = await resolveHarnessHome(home, custom)

    expect(dshHome).toBe(custom)
  })

  it('respects process.env.PAPERMACHINE_HOME when set', async () => {
    const home = await makeHome()
    const custom = await makeHome()
    process.env.PAPERMACHINE_HOME = custom
    try {
      const dshHome = await resolveHarnessHome(home)
      expect(dshHome).toBe(custom)
    } finally {
      delete process.env.PAPERMACHINE_HOME
    }
  })
})
