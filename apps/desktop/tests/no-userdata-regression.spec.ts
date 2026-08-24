import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(import.meta.dirname, '..', 'src')

/**
 * Strip `//` line comments and `/* *\/` block comments (including JSDoc) so
 * the source scan below does not fire on prose that merely discusses the
 * pattern (as this file's own docstrings do).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(full)
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : []
  }))
  return nested.flat()
}

describe('regression: the Harness home is never Electron userData', () => {
  it('apps/desktop/src has no live getPath(\'userData\') call outside comments', async () => {
    const files = await collectSourceFiles(SRC_ROOT)
    expect(files.length).toBeGreaterThan(0)

    const pattern = /getPath\(\s*['"]userData['"]\s*\)/
    const offenders: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (pattern.test(stripComments(source))) offenders.push(file)
    }

    expect(offenders).toEqual([])
  })
})
