import { spawnSync } from 'node:child_process'
const args = ['--config.verifyDepsBeforeRun=false', ...process.argv.slice(2)]
const real = '/Users/superjj/Library/pnpm/store/v11/links/@/pnpm/11.7.0/8c331c0d88cc547da3af5afe3709ff2ab54cf917ede98c38575c216c4dadd425/node_modules/pnpm/bin/pnpm.mjs'
if (args.includes('deploy')) args.unshift('--config.allowUnusedPatches=true')
const result = spawnSync(process.execPath, [real, ...args], { stdio: 'inherit', env: { ...process.env, npm_execpath: real } })
if (result.error) throw result.error
process.exit(result.status ?? 1)
