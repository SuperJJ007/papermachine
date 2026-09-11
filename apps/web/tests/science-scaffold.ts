import { errors } from 'playwright'
import type { Page } from 'playwright'
import { mkdtemp, readFile, realpath, writeFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { tmpdir } from 'node:os'
/** Science profile over the shared real Web browser harness. */
import { fileURLToPath } from 'node:url'
import { launchWebScaffold as launchBase, seedSession as seedBase, watchConsole as watchBase, type LaunchOptions } from './scaffold.ts'
export * from './scaffold.ts'

/** @param options - Per-scenario hermetic replay setup. @returns Real Science Web host. */
export async function launchWebScaffold(options: LaunchOptions) {
  const scienceOverlay = fileURLToPath(new URL('../../../packages/bundle/science-app/cordis.patch.yml', import.meta.url))
  const scratch = options.extraOverlayPath === undefined ? undefined : await mkdtemp(join(tmpdir(), 'science-web-overlay-'))
  try {
    const overlay = scratch === undefined ? scienceOverlay : join(scratch, 'overlay.yml')
    if (scratch !== undefined && options.extraOverlayPath !== undefined) {
      await writeFile(overlay, `${await readFile(scienceOverlay, 'utf8')}\n${await readFile(options.extraOverlayPath, 'utf8')}`)
    }
    return await launchBase({ ...options, extraOverlayPath: overlay,
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/science-app/package.json', import.meta.url)),
        ...options.extraInstallAnchors ?? []],
    })
  } finally {
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
  }
}

/** Seed the current durable log and attach its identity to the workspace catalog. @param args - Shared seed arguments. */
export async function seedSession(...args: Parameters<typeof seedBase>): Promise<void> {
  const id = await seedBase(args[0], args[1], args[2], args[3], { ...args[4], preserveEventTimes: true })
  const workspace = await args[0].ctx.workspaceRegistry.create(args[0].workspaceCwd)
  await workspace.attachSession(id)
}

/** Treat caught Slot failures as browser regressions too. @param page - Isolated page. @returns Collected browser errors. */
export function watchConsole(page: Page) {
  const tripwire = watchBase(page)
  page.on('console', (message) => {
    if (message.text().startsWith('slot entry crashed')) tripwire.pageErrors.push(message.text())
  })
  return tripwire
}

/** Open a seeded session by visible request text, independent of cold titles or blank-session insertion.
 * @param page - Isolated browser page.
 * @param request - Unique recorded request text.
 * @param account - Registered workspace for seeded logs, or Ungrouped for live replay sessions.
 */
export async function openScienceSeed(
  page: Page, request: string, account: 'workspace' | 'ungrouped' = 'workspace',
): Promise<void> {
  const groups = page.locator('[role="treeitem"][aria-expanded]')
  const group = (account === 'workspace'
    ? groups.filter({ has: page.locator('button[aria-label^="Workspace actions for "]') })
    : groups.filter({ hasText: 'Ungrouped' })).first()
  await group.waitFor()
  // The provisional Ungrouped row and automatic expansion can change during pointer actionability waits.
  await group.evaluate((element) => {
    if (element.getAttribute('aria-expanded') !== 'true') (element as HTMLElement).click()
  })
  const rows = page.locator('[role="treeitem"][aria-selected]').filter({ hasNotText: 'New Session' })
  await rows.first().waitFor()
  const count = await rows.count()
  for (let index = 0; index < count; index++) {
    await rows.nth(index).click()
    await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    try {
      await page.getByText(request, { exact: true }).waitFor({ timeout: 2500 })
      return
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error
    }
  }
  throw new Error(`No seeded session displayed request: ${request}`)
}

/** Allocate private Science test storage outside generic sandbox temporary grants.
 * @returns Canonical unique directory owned and removed by the caller.
 */
export async function createScienceScratch(): Promise<string> {
  const repo = fileURLToPath(new URL('../../..', import.meta.url))
  const parent = await realpath(process.env.DSH_WEB_SCIENCE_SCRATCH_PARENT ?? repo)
  for (const temp of ['/tmp', tmpdir()]) {
    const child = relative(canonicalPath(temp), parent)
    if (child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))) {
      throw new Error('DSH_WEB_SCIENCE_SCRATCH_PARENT must name an existing directory outside /tmp and os.tmpdir(); '
        + `resolved to ${parent}`)
    }
  }
  return mkdtemp(join(parent, '.web-science-preset-'))
}
