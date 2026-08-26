import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-science', ['lib/types/index.js', 'lib/types/invariant.js'])

/**
 * Select build-face outputs and pin Vega's browser runtime implementations in the CJS client bundle.
 * @param options - tsdown build-face environment.
 * @returns this package's selected build configurations.
 */
function config(options: Pick<UserConfig, 'env'>): UserConfig[] {
  return bundle({ env: options.env }).map(entry => (
    entry.name === '@deepseek-ai/dsh-client-ui-science/client'
      ? {
          ...entry,
          plugins: [{
            // Vega 6 publishes node/default loader and canvas conditions. The
            // CJS dependency pass selects the node condition unless this
            // browser bundle resolves both browser implementations first.
            name: 'dsh-ui-science-vega-browser-runtime',
            resolveId: {
              order: 'pre' as const,
              handler(source: string, importer: string | undefined) {
                if ((source !== 'vega-canvas' && source !== 'vega-loader') || importer === undefined) return null
                const nodeEntry = createRequire(importer).resolve(source)
                const browserEntry = nodeEntry.replace(/\.node\.js$/, '.browser.js')
                if (browserEntry === nodeEntry || !existsSync(browserEntry)) {
                  throw new Error(`${source} no longer resolves to a .node.js entry with a .browser.js sibling (got ${nodeEntry}); its node implementation must not reach the browser bundle`)
                }
                return browserEntry
              },
            },
          }, ...(entry.plugins ?? [])],
        }
      : entry
  ))
}

export default config
