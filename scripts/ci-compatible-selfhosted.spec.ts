/** Standard hosted Node compatibility jobs retain the supported loader versions. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface Step {
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}
interface CompatibilityJob {
  'runs-on': string
  if: string
  env: Record<string, string>
  strategy: { 'fail-fast': boolean; matrix: { include: Array<{ node: string | number; name: string; runner: string; gate_concurrency: string }> } }
  steps: Step[]
}
const workflow = yaml.load(readFileSync(resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8')) as {
  jobs: { 'node-compat': CompatibilityJob; 'python-sdk': { 'runs-on': string } }
}
const job = workflow.jobs['node-compat']

describe('Node compatibility hosted routing', () => {
  it('uses the hosted matrix for every PR author and repository', () => {
    expect(job['runs-on']).toBe('${{ matrix.runner }}')
    expect(JSON.stringify(job)).not.toMatch(/DSH_CI_FAILOVER|self-hosted|NODE_OPTIONS|ci-compatible-toolcache/)
  })

  it('preserves all three required version jobs and their concurrency', () => {
    expect(job.if).toBe("github.event_name == 'pull_request'")
    expect(job.strategy['fail-fast']).toBe(false)
    expect(job.strategy.matrix.include).toEqual([
      { node: '22.19', name: 'node 22.19', runner: 'ubuntu-latest', gate_concurrency: '1' },
      { node: '24.9', name: 'node 24.9', runner: 'ubuntu-latest', gate_concurrency: '1' },
      { node: 26, name: 'node 26', runner: 'ubuntu-latest', gate_concurrency: '1' },
    ])
    expect(job.env.DSH_GATE_CONCURRENCY).toBe('${{ matrix.gate_concurrency }}')
    expect(job.steps.map(step => step.run)).toContain('pnpm run check:node-compat')
    expect(job.steps.map(step => step.run)).toContain('pnpm exec vitest run packages/boot/app-boot/tests/loader-shape.compat.spec.ts')
    expect(workflow.jobs['python-sdk']['runs-on']).toBe('ubuntu-latest')
  })

  it('uses the selected Node version and restores its pnpm cache', () => {
    const setup = job.steps.find(step => step.uses === 'actions/setup-node@v6')!
    expect(setup.env).toBeUndefined()
    expect(setup.with).toMatchObject({
      'node-version': '${{ matrix.node }}', cache: 'pnpm', 'package-manager-cache': false,
    })
    expect(job.steps[0]?.with).toEqual({ 'persist-credentials': false })
  })
})
