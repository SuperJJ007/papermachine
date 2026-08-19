/**
 * Resolves the zero-dependency kernel driver scripts shipped in this
 * package's own `assets/` directory: `kernel_python.py` (Python stdlib
 * only) and `kernel_r.R` (base R only). Resolution is relative to this
 * module's own on-disk location via `import.meta.url`, so it is correct
 * whether this module runs from `src/kernel-assets.ts` (tsx source launch)
 * or from the tsdown-bundled `lib/index.js` (built launch) — both sit
 * exactly one directory below the package root, the same depth as the
 * sibling `assets/` directory.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScienceLanguage } from '@deepseek-ai/dsh-science-session'

/** This package's own shipped assets directory, resolved from this module's location. */
export const KERNEL_ASSETS_ROOT: string = fileURLToPath(new URL('../assets/', import.meta.url))

/** Driver script file name shipped for each Science kernel language. */
const KERNEL_DRIVER_FILE_NAMES: Readonly<Record<ScienceLanguage, string>> = {
  python: 'kernel_python.py',
  r: 'kernel_r.R',
}

/**
 * Resolve one Science language's kernel driver script under an assets root.
 * Production callers pass {@link KERNEL_ASSETS_ROOT}; tests pass an
 * independently-computed root (or a nonexistent one, to exercise the
 * failure path) without depending on this module's own `import.meta.url`.
 * @param assetsRoot - absolute directory to resolve the driver script under.
 * @param language - the Science language whose kernel driver to resolve.
 * @returns the driver script's absolute on-disk path.
 * @throws {Error} when the resolved path does not exist on disk — a
 *   packaging defect, never silently substituted with a guess.
 */
export function resolveKernelDriverPath(assetsRoot: string, language: ScienceLanguage): string {
  const path = join(assetsRoot, KERNEL_DRIVER_FILE_NAMES[language])
  if (!existsSync(path)) {
    throw new Error(`science-runtime: kernel driver asset missing at ${path} (language: ${JSON.stringify(language)})`)
  }
  return path
}
