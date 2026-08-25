/**
 * Project-owned Science artifact registry and content-addressed version
 * store: workspace project identity, one SQLite index plus content-addressed
 * blobs per project under the harness home, and the linear-chain append
 * operation that lets any session in a project read, reference, and extend
 * an artifact any other session in the same project created.
 * @module @deepseek-ai/dsh-science-artifact-store
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ProjectArtifactStoreEngine } from './store.ts'
import type { JournalMode } from './schema.ts'
import type {
  AnnotateVersionInput,
  AppendVersionInput,
  ArtifactRecord,
  CreateArtifactInput,
  OpenedProject,
  VersionRecord,
} from './types.ts'
import type { ArtifactId, ProjectId, VersionId } from './ids.ts'

export { ArtifactId, ProjectId, VersionId } from './ids.ts'
export { ProjectArtifactStoreError, type ProjectArtifactStoreErrorCode } from './errors.ts'
export { PROJECT_ARTIFACT_STORE_SCHEMA_VERSION, type JournalMode } from './schema.ts'
export type {
  AnnotateVersionInput,
  AppendVersionInput,
  ArtifactRecord,
  ArtifactVersionOrigin,
  CreateArtifactInput,
  OpenedProject,
  ProjectIdentityOutcome,
  VersionRecord,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    scienceArtifactStore: ScienceArtifactStore
  }
}

/** Cordis service key this package registers. */
export const name = 'science-artifact-store'

/** Plugin configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /**
   * SQLite `journal_mode` pragma for every project's `store.sqlite`. `wal`
   * (the default) suits local disks; pick a rollback-journal mode on
   * filesystems where WAL's shared-memory files do not work (network mounts).
   */
  journalMode?: JournalMode
  /**
   * Maximum time, in milliseconds, a writer blocks waiting for a competing
   * SQLite write lock before failing (`sqlite3_busy_timeout()`). This is
   * what makes the append linearization point correct across concurrent
   * processes instead of failing the second writer outright.
   */
  busyTimeoutMs?: number
}

/**
 * The project artifact store service. Registers as `ctx.scienceArtifactStore`;
 * every method is self-sufficient given a `projectId` (no prior `openProject`
 * call is required in the same process), so a Host restart or a second
 * session in the same project can resume work against a project it already
 * knows the id of.
 */
export class ScienceArtifactStore extends Service {
  /** Schemastery validator for {@link Config}. */
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.number().min(0).default(5000),
  })

  private readonly engine: ProjectArtifactStoreEngine

  /**
   * @param ctx - Plugin context.
   * @param config - Validated plugin configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'scienceArtifactStore')
    const resolved = config as Required<Config>
    this.engine = new ProjectArtifactStoreEngine({
      journalMode: resolved.journalMode,
      busyTimeoutMs: resolved.busyTimeoutMs,
      ...config.dshHome === undefined ? {} : { dshHome: config.dshHome },
    })
    ctx.effect(() => () => this.engine.close(), 'science-artifact-store.close')
  }

  /**
   * Resolve a workspace directory's project identity and ensure its store is open.
   * @param workspacePath - the workspace directory to resolve.
   * @returns the resolved identity, store root, and how it was resolved.
   */
  openProject(workspacePath: string): Promise<OpenedProject> {
    return this.engine.openProject(workspacePath)
  }

  /**
   * Create a new artifact and its first version.
   * @param projectId - the owning project.
   * @param input - the first version's bytes, media type, origin, and metadata.
   * @returns the created artifact and its first version.
   */
  createArtifact(projectId: ProjectId, input: CreateArtifactInput): Promise<{ artifact: ArtifactRecord; version: VersionRecord }> {
    return this.engine.createArtifact(projectId, input)
  }

  /**
   * Append a new version onto an existing artifact, linearized against every
   * other concurrent append to the same artifact.
   * @param projectId - the owning project.
   * @param artifactId - the artifact to append to.
   * @param input - the new version's bytes, media type, origin, and metadata.
   * @returns the appended version.
   */
  appendVersion(projectId: ProjectId, artifactId: ArtifactId, input: AppendVersionInput): Promise<VersionRecord> {
    return this.engine.appendVersion(projectId, artifactId, input)
  }

  /**
   * Apply a metadata-only patch to one version in place.
   * @param projectId - the owning project.
   * @param versionId - the version to curate.
   * @param patch - fields to overwrite; an omitted field keeps its current value.
   * @returns the updated version.
   */
  annotateVersion(projectId: ProjectId, versionId: VersionId, patch: AnnotateVersionInput): Promise<VersionRecord> {
    return this.engine.annotateVersion(projectId, versionId, patch)
  }

  /**
   * Look up one artifact by id.
   * @param projectId - the owning project.
   * @param artifactId - the artifact to look up.
   * @returns the artifact, or `undefined` when no such artifact exists.
   */
  getArtifact(projectId: ProjectId, artifactId: ArtifactId): Promise<ArtifactRecord | undefined> {
    return this.engine.getArtifact(projectId, artifactId)
  }

  /**
   * Look up one version by id.
   * @param projectId - the owning project.
   * @param versionId - the version to look up.
   * @returns the version, or `undefined` when no such version exists.
   */
  getVersion(projectId: ProjectId, versionId: VersionId): Promise<VersionRecord | undefined> {
    return this.engine.getVersion(projectId, versionId)
  }

  /**
   * Look up an artifact's current latest version.
   * @param projectId - the owning project.
   * @param artifactId - the artifact whose latest version to fetch.
   * @returns the latest version, or `undefined` when the artifact does not exist.
   */
  getLatestVersion(projectId: ProjectId, artifactId: ArtifactId): Promise<VersionRecord | undefined> {
    return this.engine.getLatestVersion(projectId, artifactId)
  }

  /**
   * List every artifact in a project, oldest first.
   * @param projectId - the owning project.
   * @returns every artifact currently in the project's store.
   */
  listArtifacts(projectId: ProjectId): Promise<readonly ArtifactRecord[]> {
    return this.engine.listArtifacts(projectId)
  }

  /**
   * List one artifact's versions in ordinal order.
   * @param projectId - the owning project.
   * @param artifactId - the artifact whose versions to list.
   * @returns every version of the artifact, oldest first.
   */
  listVersions(projectId: ProjectId, artifactId: ArtifactId): Promise<readonly VersionRecord[]> {
    return this.engine.listVersions(projectId, artifactId)
  }

  /**
   * Read one version's bytes by content address.
   * @param projectId - the owning project.
   * @param sha256 - the digest from an already-resolved version row.
   * @returns the verified bytes.
   */
  readBlob(projectId: ProjectId, sha256: string): Promise<Uint8Array> {
    return this.engine.readBlob(projectId, sha256)
  }

  /**
   * Permanently delete a project's entire store. The one cascade boundary:
   * session deletion never calls this, and never removes artifact rows.
   * @param projectId - the project to delete.
   */
  deleteProject(projectId: ProjectId): Promise<void> {
    return this.engine.deleteProject(projectId)
  }
}

export default ScienceArtifactStore
