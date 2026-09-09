/** Resolve the product-owned preset root for the Science bundle configuration. */
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Absolute directory containing the bundled PaperMachine presets. */
    sciencePresetRoot: string
  }
}

/** Loader plugin name for the product preset path. */
export const name = 'science-app'

/**
 * Publish the preset path for configuration entries that explicitly inject it.
 * @param ctx - Host context owning the product composition.
 */
export function apply(ctx: Context): void {
  ctx.provide('sciencePresetRoot', fileURLToPath(new URL('../presets/', import.meta.url)))
}
