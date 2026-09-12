/** PaperMachine's environment state and per-launch profile configuration. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'
import { parseEnvironmentDeclaration, isDesktopPlatform, micromambaExecutableName } from './environment-declaration.ts'
import { resolveEnvironmentBindingStatus, resolveBindRequest, writeEnvironmentBinding } from './environment-binding.ts'
import { qualifyingInterpreters } from './interpreter-presence.ts'
import { DesktopEnvironmentProvisioner, desktopEnvironmentsRoot, orderSourcesFrom, type ProvisioningProgress } from './provisioning.ts'
import { buildCustomDeclaration, writeCustomDeclaration } from './custom-environment.ts'

/** Filesystem inputs owned by the shell; resources never come from the renderer. */
export class ProductEnvironment {
  constructor(readonly home: string, readonly resources: string) {}

  /** Read and validate the packaged install declaration. */
  async declaration() {
    return parseEnvironmentDeclaration(JSON.parse(await readFile(join(this.resources, 'environments/general.json'), 'utf8')))
  }

  private provisioner(): DesktopEnvironmentProvisioner {
    const platform = `${process.platform}-${process.arch}`
    if (!isDesktopPlatform(platform)) throw new Error(`desktop: unsupported environment platform ${platform}`)
    return new DesktopEnvironmentProvisioner({
      root: desktopEnvironmentsRoot(this.home), platform,
      micromambaPath: join(this.resources, 'bin', platform, micromambaExecutableName(platform)),
    })
  }

  /** Read durable binding and prove its interpreters still exist before launching. */
  async status() {
    const status = await resolveEnvironmentBindingStatus(this.home)
    if (status.kind !== 'bound') return status
    for (const [language, prefix] of [['python', status.binding.pythonPrefix], ['r', status.binding.rPrefix]] as const) {
      if (prefix === undefined) continue
      const presence = await qualifyingInterpreters(prefix)
      if (presence?.[language] !== true) return { kind: 'invalid' as const, reason: `desktop: ${language} interpreter is unavailable at ${prefix}` }
    }
    return status
  }

  /** Provision an approved source and package set; publish binding only after verification.
   * @param sourceId - A source from the packaged declaration.
   * @param packages - Optional user-authored package list.
   * @param signal - Cancellation that waits for child termination.
   * @param progress - Bounded progress delivered to the shell renderer.
   */
  async install(
    sourceId: string, packages: readonly string[] | undefined,
    signal: AbortSignal, progress: (value: ProvisioningProgress) => void,
  ): Promise<void> {
    const shipped = await this.declaration()
    if (!shipped.sources.some(source => source.id === sourceId)) throw new Error('desktop: unknown package source')
    const declaration = packages === undefined ? shipped : buildCustomDeclaration(packages, shipped.supportedPlatforms, shipped.sources)
    if (packages !== undefined) await writeCustomDeclaration(desktopEnvironmentsRoot(this.home), declaration)
    const applied = await this.provisioner().provision(declaration, signal, progress, sourceId)
    signal.throwIfAborted()
    const binding = await resolveBindRequest(
      { pythonPrefix: applied.prefix, rPrefix: applied.prefix, sourceId: applied.sourceId }, qualifyingInterpreters,
    )
    await writeEnvironmentBinding(this.home, binding)
  }

  /** Rewrite machine facts before both staged health probes and active Host starts.
   * @param project - Active or staged desktop profile directory.
   */
  async writeOverlay(project: string, allowUnbound = false): Promise<void> {
    const minimumEnforcement = process.env['PAPERMACHINE_SCIENCE_MINIMUM_ENFORCEMENT']
      ?? (process.platform === 'win32' ? 'partial' : 'full')
    if (minimumEnforcement !== 'full' && minimumEnforcement !== 'partial') {
      throw new Error('desktop: PAPERMACHINE_SCIENCE_MINIMUM_ENFORCEMENT must be full or partial')
    }
    const status = await this.status()
    if (status.kind !== 'bound') {
      if (allowUnbound) return
      throw new Error(status.kind === 'invalid' ? status.reason : 'desktop: environment is not installed')
    }
    const declaration = await this.declaration()
    const config = {
      minimumEnforcement,
      profiles: { science: { pythonPrefix: status.binding.pythonPrefix, rPrefix: status.binding.rPrefix } },
      micromambaPath: this.provisioner().options.micromambaPath,
      installChannels: orderSourcesFrom(declaration.sources, status.binding.sourceId).flatMap(source => source.channels),
      installTimeoutMs: declaration.timeoutMs,
    }
    const patch = [
      { id: 'science-runtime', config },
      { id: 'skill-filesystem', disabled: false, config: { providerName: 'bundled-skills', includeDefaultRoots: false, bundledSkillDir: join(this.resources, 'skills') } },
    ]
    await mkdir(project, { recursive: true, mode: 0o700 })
    await writeFileAtomic(join(project, 'cordis.patch.yml'), `${JSON.stringify(patch, undefined, 2)}\n`, { mode: 0o600 })
  }
}
