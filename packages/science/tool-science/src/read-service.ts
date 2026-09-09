/** Session-authorized Science library, workspace, and attachment reads. */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionEvent } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-attachment-index'
import { decodeReferencedText } from '@deepseek-ai/dsh-session-attachment-index'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { VersionId, ProjectArtifactStoreError } from '@deepseek-ai/dsh-science-artifact-store'
import type { ArtifactId, ContentOrigin, ScienceArtifactStore, VersionHealthRecord } from '@deepseek-ai/dsh-science-artifact-store'
import { decodeScienceChartState, foldScience } from '@deepseek-ai/dsh-science-session'
import type { ScienceChartState, ScienceArtifactMediaType } from '@deepseek-ai/dsh-science-session'
import type { ScienceLibraryArtifact, ScienceLibraryHealth, ScienceVersionSummary, ScienceVersionHealthFlags } from './read-types.ts'

interface SessionReadState { header: SessionHeader; events: readonly SessionEvent[] }
/** Limits for workspace reads from the authenticated Science surface. */
export interface Config { workspaceEntryLimit: number; workspaceFileByteLimit: number }
/** Validated deployment limits for directory and file previews. */
export const Config: z<Config> = z.object({
  workspaceEntryLimit: z.number().min(1).step(1).default(1000),
  workspaceFileByteLimit: z.number().min(1).step(1).default(2 * 1024 * 1024),
})

declare module '@deepseek-ai/cordis' { interface Context { scienceReads: ScienceReadService } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'science-artifact-error': { reason: string }
    'attachment-error': { reason: string }
  }
}
function failure(reason: string, message: string): RemoteError<'science-artifact-error'> {
  return new RemoteError('science-artifact-error', message, { reason })
}
function workspaceMediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.csv': return 'text/csv'
    case '.json': return 'application/json'
    case '.md': case '.markdown': return 'text/markdown'
    case '.txt': return 'text/plain'
    case '.png': return 'image/png'
    default: return 'application/octet-stream'
  }
}

/**
 * Narrow durable store metadata to the media set the Science library can
 * render, or `undefined` for a version whose stored media type this build no
 * longer renders (a legacy on-disk value such as a removed Vega-Lite spec).
 * The library listing drops that one version rather than failing the whole
 * project's listing over a single unrenderable row.
 */
function scienceArtifactMediaType(value: string): ScienceArtifactMediaType | undefined {
  switch (value) {
    case 'image/png': case 'text/csv': case 'application/json': case 'text/markdown': case 'text/plain': return value
    default: return undefined
  }
}

/**
 * Narrow a store health record (when this exact version has one) to the
 * wire's `{ health?: ScienceVersionHealthFlags }` spread — `orphan` is never
 * included (see `ScienceVersionHealthFlags`'s own JSDoc), and an absent or
 * fully-healthy record spreads to nothing.
 * @param record - this version's `version_health` row, when the last
 * reconciliation pass recorded one.
 * @returns a spreadable `{ health }` field, or `{}` when nothing to report.
 */
function versionHealthFlags(record: VersionHealthRecord | undefined): { health?: ScienceVersionHealthFlags } {
  if (record === undefined || (!record.reconstructed && !record.missingContent)) return {}
  return {
    health: {
      ...record.reconstructed ? { reconstructed: true as const } : {},
      ...record.missingContent ? { missingContent: true as const } : {},
    },
  }
}

/** Store row plus project identity proven by a session's strict Science fold. */
interface AuthorizedScienceArtifact {
  readonly projectId: Parameters<ScienceArtifactStore['readBlob']>[0]
  readonly artifactId: ArtifactId
  readonly versionId: VersionId
  /** This version's 1-based position among its artifact's versions — the raw-bytes download filename's `-v<ordinal>` suffix. */
  readonly ordinal: number
  readonly sha256: string
  readonly mediaType: string
  readonly byteCount: number
  /**
     * This version's current title/caption, when curated — read fresh from
     * the store, never a session-log snapshot; `scienceVersions`'s source.
     */
  readonly title: string | undefined
  readonly caption: string | undefined
  readonly contentOrigin: ContentOrigin
  /** Content-commit time (never changes after creation — see `VersionRecord.createdAt`). */
  readonly createdAt: number
  readonly producerSessionId: SessionId
  readonly producerRunId: string | undefined
  readonly producerToolCallId: string | undefined
  readonly producerRequestHeaderSeq: number | undefined
  readonly producerTurn: number | undefined
}

/**
 * Authorize versions within the project selected by the session header's cwd.
 * Missing cwd denies reads. Session-produced artifacts use their event coordinates;
 * other versions in that project are readable after verification by the store.
 */
async function authorizedScienceArtifact(
  state: SessionReadState,
  requestedVersionId: VersionId,
  store: ScienceArtifactStore,
): Promise<AuthorizedScienceArtifact | undefined> {
  if (state.header.cwd === undefined) return undefined
  const fold = foldScience(state.events)
  const local = fold.artifacts.find(artifact => artifact.versionId === requestedVersionId)
  if (local !== undefined) {
    // The session event only pins `sha256` (its own presentation-time
    // fields, per T2a's event slimming); `mediaType`/`byteCount` are
    // content facts owned solely by the store, read fresh rather than
    // trusted from the event.
    const version = await store.getVersion(local.projectId, local.versionId)
    if (version === undefined) return undefined
    return {
      projectId: local.projectId,
      artifactId: version.artifactId,
      versionId: local.versionId,
      ordinal: version.ordinal,
      sha256: local.sha256,
      mediaType: version.mediaType,
      byteCount: version.byteCount,
      title: version.title,
      caption: version.caption,
      contentOrigin: version.contentOrigin,
      createdAt: version.createdAt,
      producerSessionId: version.producerSessionId,
      producerRunId: version.producerRunId,
      producerToolCallId: version.producerToolCallId,
      producerRequestHeaderSeq: version.producerRequestHeaderSeq,
      producerTurn: version.producerTurn,
    }
  }

  const projectId = (await store.openProject(state.header.cwd)).projectId
  const projectVersion = await store.getVersion(projectId, requestedVersionId)
  return projectVersion === undefined ? undefined : {
    projectId,
    artifactId: projectVersion.artifactId,
    versionId: projectVersion.versionId,
    ordinal: projectVersion.ordinal,
    sha256: projectVersion.sha256,
    mediaType: projectVersion.mediaType,
    byteCount: projectVersion.byteCount,
    title: projectVersion.title,
    caption: projectVersion.caption,
    contentOrigin: projectVersion.contentOrigin,
    createdAt: projectVersion.createdAt,
    producerSessionId: projectVersion.producerSessionId,
    producerRunId: projectVersion.producerRunId,
    producerToolCallId: projectVersion.producerToolCallId,
    producerRequestHeaderSeq: projectVersion.producerRequestHeaderSeq,
    producerTurn: projectVersion.producerTurn,
  }
}
async function resolveWorkspacePath(state: SessionReadState, requestedPath: string): Promise<{
  readonly workspace: string
  readonly target: string
  readonly display: string
}> {
  if (state.header.cwd === undefined) {
    throw failure('NO_WORKSPACE', 'Session has no workspace directory.')
  }
  if (isAbsolute(requestedPath) || requestedPath.split(/[\\/]/u).includes('..')) {
    throw failure('PATH_OUTSIDE_WORKSPACE', 'Path is outside the session workspace.')
  }
  const workspace = await realpath(state.header.cwd)
  const candidate = resolve(workspace, requestedPath)
  const target = await realpath(candidate)
  const delta = relative(workspace, target)
  if (delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)) {
    throw failure('PATH_OUTSIDE_WORKSPACE', 'Path is outside the session workspace.')
  }
  return { workspace, target, display: delta.split(sep).join('/') }
}

/**
 * Content-Disposition filename for one Science artifact raw-bytes download:
 * the logical name with its own extension stripped, `-v<ordinal>` inserted,
 * and that same extension re-appended (`chart.png` v3 → `chart-v3.png`). A
 * logical name with no extension keeps none — this never fabricates one from
 * `mediaType`.
 * @param logicalName - the owning artifact's current logical name.
 * @param ordinal - the downloaded version's 1-based position among its artifact's versions.
 * @returns the filename, still requiring RFC 5987/6266 encoding before use in a header.
 */
function scienceArtifactDownloadFilename(logicalName: string, ordinal: number): string {
  const ext = extname(logicalName)
  const base = ext === '' ? logicalName : logicalName.slice(0, -ext.length)
  return `${base}-v${ordinal}${ext}`
}

/**
 * Percent-encode a filename for RFC 5987's `ext-value` production, the
 * `filename*=UTF-8''…` half of `Content-Disposition`. `encodeURIComponent`
 * already escapes everything outside `unreserved`/most `sub-delims`; RFC
 * 5987 §3.2.1 additionally excludes `!'()*` from `attr-char`, so those four
 * are percent-encoded a second pass.
 * @param filename - the filename to encode.
 * @returns the `attr-char`-safe percent-encoded value.
 */
function encodeRfc5987Filename(filename: string): string {
  return encodeURIComponent(filename).replace(/[!'()*]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * ASCII-only fallback for `Content-Disposition`'s plain `filename=` parameter
 * (RFC 6266 recommends pairing it with `filename*` for user agents that
 * ignore the extended form). Non-printable-ASCII and quote/backslash
 * characters — which would otherwise break the quoted-string — degrade to `_`.
 * @param filename - the filename to sanitize.
 * @returns an ASCII, quote/backslash-free filename of the same length.
 */
function asciiFallbackFilename(filename: string): string {
  return filename.replace(/[^\u0020-\u007E]|["\\]/gu, '_')
}

/** Read-only Remote service over a session's project and durable attachment references. */
export class ScienceReadService extends TypertRemoteService {
  static inject = ['sessionQuery', 'scienceArtifactStore', 'sessionAttachments', 'attachments', 'typert']
  /**
 * @param ctx - Composed Host services.
 * @param config - Validated preview limits.
 */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'scienceReads', { namespace: 'science' })
    ctx.inject(['connection'], (ctx) => {
      ctx.effect(() => ctx.connection.fetch.register({
        path: '/api/science-artifact', methods: ['GET', 'HEAD'], requestBody: 'buffered',
        fetch: request => this.download(request),
      }), 'science artifact bytes')
    })
  }
  private async readSessionState(sessionId: SessionId): Promise<SessionReadState> {
    const state = await this.ctx.sessionQuery.readSession(sessionId)
    return { header: state.session, events: state.events }
  }
  private async readable(sessionId: SessionId, versionId: VersionId): Promise<AuthorizedScienceArtifact> {
    const artifact = await authorizedScienceArtifact(await this.readSessionState(sessionId), versionId, this.ctx.scienceArtifactStore)
    if (artifact === undefined) throw failure('VERSION_NOT_REFERENCED', 'Science artifact version is not referenced by this session.')
    return artifact
  }
  /**
 * Read one session-authorized immutable version.
 * @param sessionId - Authorizing session.
 * @param versionId - Exact version.
 * @returns Verified bytes encoded as base64.
 */
  @Remote
  async scienceArtifact(sessionId: SessionId, versionId: VersionId):
  Promise<{ versionId: VersionId; mediaType: string; byteCount: number; data: string }> {
    const artifact = await this.readable(sessionId, versionId)
    const data = await this.ctx.scienceArtifactStore.readBlob(artifact.projectId, artifact.sha256)
    return { versionId, mediaType: artifact.mediaType, byteCount: data.byteLength, data: Buffer.from(data).toString('base64') }
  }
  /**
 * Read an exact version's editable chart state.
 * @param sessionId - Authorizing session.
 * @param versionId - Exact version.
 * @returns Chart state or null for non-chart versions.
 */
  @Remote
  async scienceChartState(sessionId: SessionId, versionId: VersionId): Promise<{ chart: ScienceChartState | null }> {
    const artifact = await this.readable(sessionId, versionId)
    if (artifact.mediaType !== 'image/png') return { chart: null }
    const figure = await this.ctx.scienceArtifactStore.getFigureState(artifact.projectId, versionId)
    return { chart: figure === undefined ? null : decodeScienceChartState(JSON.parse(figure.stateJson) as unknown) }
  }
  /**
 * Read a referenced UTF-8 file.
 * @param sessionId - Authorizing session.
 * @param attachmentId - Durable file identity.
 * @returns Validated text with its reference.
 */
  @Remote
  async textAttachment(sessionId: SessionId, attachmentId: AttachmentId): Promise<{ attachment: FileAttachmentRef; data: string }> {
    const state = await this.readSessionState(sessionId)
    const ref = this.ctx.sessionAttachments.findReferencedFile(state.events, attachmentId)
    if (ref === undefined) throw new RemoteError('attachment-error', 'File is not referenced by this session.', { reason: 'ATTACHMENT_NOT_REFERENCED' })
    if (ref.bytes > this.config.workspaceFileByteLimit) throw failure('FILE_TOO_LARGE', 'Text attachment exceeds the preview limit.')
    const chunks: Uint8Array[] = []
    for await (const chunk of this.ctx.attachments.readFileStream(ref)) chunks.push(chunk)
    return { attachment: ref, data: decodeReferencedText(ref, Buffer.concat(chunks)) }
  }
  /**
 * Read current project metadata.
 * @param sessionId - Authorizing session.
 * @returns Current authorized store facts.
 */
  @Remote
  async scienceLibrary(sessionId: SessionId):
  Promise<{ projectId: string; artifacts: ScienceLibraryArtifact[]; health: ScienceLibraryHealth }> {
    const state = await this.readSessionState(sessionId)
    const store = this.ctx.scienceArtifactStore
    if (state.header.cwd === undefined) throw failure('NO_WORKSPACE', 'Session has no workspace directory.')

    const projectId = (await store.openProject(state.header.cwd)).projectId
    const [records, reconciliation] = await Promise.all([
      store.listArtifacts(projectId),
      store.getReconciliationSummary(projectId),
    ])
    const healthByVersionId = new Map(reconciliation.items.map(item => [item.versionId, item]))
    const artifacts = (await Promise.all(records.map(async (record) => {
      const latest = await store.getLatestVersion(projectId, record.artifactId)
      if (latest === undefined) return undefined
      // A version stored in a media type this build no longer renders
      // (a legacy Vega-Lite spec from before that format was removed)
      // drops from the renderable library instead of failing the whole
      // project's listing.
      const latestMediaType = scienceArtifactMediaType(latest.mediaType)
      if (latestMediaType === undefined) return undefined
      let originSessionTitle: string | undefined
      try {
        originSessionTitle = (await this.ctx.sessionQuery.readTitle(record.originSessionId))?.title
      } catch { /* A removed origin session does not make its project artifact disappear. */ }
      return {
        artifactId: record.artifactId, logicalName: record.logicalName,
        ...(latest.title === undefined ? {} : { title: latest.title }),
        ...(latest.caption === undefined ? {} : { caption: latest.caption }),
        originSessionId: record.originSessionId,
        ...(originSessionTitle === undefined ? {} : { originSessionTitle }),
        latest: {
          versionId: latest.versionId, ordinal: latest.ordinal, mediaType: latestMediaType,
          byteCount: latest.byteCount, createdAt: latest.createdAt,
          ...versionHealthFlags(healthByVersionId.get(latest.versionId)),
        },
      }
    }))).filter(item => item !== undefined)
    return {
      projectId,
      artifacts,
      health: {
        orphan: reconciliation.orphanCount,
        reconstructed: reconciliation.reconstructedCount,
        missingContent: reconciliation.missingContentCount,
      },
    }

  }
  /**
 * Read current project metadata.
 * @param sessionId - Authorizing session.
 * @param versionIds - Exact versions to resolve.
 * @returns Current authorized store facts.
 */
  @Remote
  async scienceVersions(sessionId: SessionId, versionIds: readonly VersionId[]): Promise<{ versions: ScienceVersionSummary[] }> {
    const state = await this.readSessionState(sessionId)
    const store = this.ctx.scienceArtifactStore

    // logicalName has no home on AuthorizedScienceArtifact (only the
    // download endpoint needs it, fetched there post-blob-read), and
    // health is a per-project reconciliation read — both cached per
    // request since a version stepper's batch is dominated by repeats
    // of the same artifact/project.
    const logicalNameByArtifact = new Map<string, string>()
    const healthByProject = new Map<string, Map<VersionId, VersionHealthRecord>>()
    const titleByProducerSession = new Map<SessionId, string | undefined>()
    const versions: ScienceVersionSummary[] = []
    for (const versionId of versionIds) {
      // Unauthorized/nonexistent versions are dropped from the result,
      // not failed — see this RPC's own JSDoc for why partial
      // visibility is the expected outcome of a batch read.
      const authorized = await authorizedScienceArtifact(state, versionId, store)
      if (authorized === undefined) continue
      const artifactKey = `${authorized.projectId}:${authorized.artifactId}`
      let logicalName = logicalNameByArtifact.get(artifactKey)
      if (logicalName === undefined) {
        const owner = await store.getArtifact(authorized.projectId, authorized.artifactId)
        if (owner === undefined) continue
        logicalName = owner.logicalName
        logicalNameByArtifact.set(artifactKey, logicalName)
      }
      let healthByVersionId = healthByProject.get(String(authorized.projectId))
      if (healthByVersionId === undefined) {
        const reconciliation = await store.getReconciliationSummary(authorized.projectId)
        healthByVersionId = new Map(reconciliation.items.map(item => [item.versionId, item]))
        healthByProject.set(String(authorized.projectId), healthByVersionId)
      }
      let producerSessionTitle = titleByProducerSession.get(authorized.producerSessionId)
      if (!titleByProducerSession.has(authorized.producerSessionId)) {
        try {
          producerSessionTitle = (await this.ctx.sessionQuery.readTitle(authorized.producerSessionId))?.title
        } catch { /* A removed producer session does not invalidate its project artifact. */ }
        titleByProducerSession.set(authorized.producerSessionId, producerSessionTitle)
      }
      versions.push({
        versionId: authorized.versionId,
        artifactId: authorized.artifactId,
        logicalName,
        ordinal: authorized.ordinal,
        ...(authorized.title === undefined ? {} : { title: authorized.title }),
        ...(authorized.caption === undefined ? {} : { caption: authorized.caption }),
        contentOrigin: authorized.contentOrigin,
        createdAt: authorized.createdAt,
        mediaType: authorized.mediaType,
        byteCount: authorized.byteCount,
        producer: {
          sessionId: authorized.producerSessionId,
          ...(producerSessionTitle === undefined ? {} : { sessionTitle: producerSessionTitle }),
          ...(authorized.producerRunId === undefined ? {} : { runId: authorized.producerRunId }),
          ...(authorized.producerToolCallId === undefined ? {} : { toolCallId: authorized.producerToolCallId }),
          ...(authorized.producerRequestHeaderSeq === undefined
            ? {}
            : { requestHeaderSeq: authorized.producerRequestHeaderSeq }),
          ...(authorized.producerTurn === undefined ? {} : { turn: authorized.producerTurn }),
        },
        ...versionHealthFlags(healthByVersionId.get(versionId)),
      })
    }
    return { versions }

  }
  /**
 * List contained workspace entries.
 * @param sessionId - Owning session.
 * @param path - Relative directory.
 * @returns Bounded directory listing.
 */
  @Remote
  async workspaceFiles(sessionId: SessionId, path?: string):
  Promise<{ root: string; entries: Array<{ name: string; kind: 'dir' | 'file'; modifiedAt: number; byteCount?: number; mediaType?: string }>; truncated?: true }> {
    const resolved = await resolveWorkspacePath(await this.readSessionState(sessionId), path ?? '')
    const children = (await readdir(resolved.target, { withFileTypes: true }))
      .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules' && !entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name))
    const entries = await Promise.all(children.slice(0, this.config.workspaceEntryLimit).map(async (entry) => {
      const info = await stat(resolve(resolved.target, entry.name))
      return entry.isDirectory()
        ? { name: entry.name, kind: 'dir' as const, modifiedAt: info.mtimeMs }
        : { name: entry.name, kind: 'file' as const, modifiedAt: info.mtimeMs, byteCount: info.size, mediaType: workspaceMediaType(entry.name) }
    }))
    return { root: resolved.display, entries, ...(children.length > this.config.workspaceEntryLimit ? { truncated: true as const } : {}) }
  }
  /**
 * Read a bounded workspace preview.
 * @param sessionId - Owning session.
 * @param path - Relative file.
 * @returns Base64 file content.
 */
  @Remote
  async workspaceFile(sessionId: SessionId, path: string): Promise<{ mediaType: string; byteCount: number; data: string }> {
    const resolved = await resolveWorkspacePath(await this.readSessionState(sessionId), path)
    const info = await stat(resolved.target)
    if (!info.isFile()) throw failure('PATH_OUTSIDE_WORKSPACE', 'Workspace preview path is not a file.')
    if (info.size > this.config.workspaceFileByteLimit) throw failure('FILE_TOO_LARGE', 'Workspace file exceeds the preview limit.')
    const data = await readFile(resolved.target)
    if (data.byteLength > this.config.workspaceFileByteLimit) throw failure('FILE_TOO_LARGE', 'Workspace file exceeds the preview limit.')
    return { mediaType: workspaceMediaType(resolved.target), byteCount: data.byteLength, data: data.toString('base64') }
  }
  private async download(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    const versionId = url.searchParams.get('versionId')
    if (!sessionId || !versionId) return new Response(null, { status: 400 })
    let artifact: AuthorizedScienceArtifact
    try { artifact = await this.readable(SessionId(sessionId), VersionId(versionId)) }
    catch {
      // Session lookup and authorization failures share 404 to avoid disclosing session or version existence.
      return new Response(null, { status: 404 })
    }
    try {
      const data = await this.ctx.scienceArtifactStore.readBlob(artifact.projectId, artifact.sha256)
      request.signal.throwIfAborted()
      const owner = await this.ctx.scienceArtifactStore.getArtifact(artifact.projectId, artifact.artifactId)
      const filename = scienceArtifactDownloadFilename(owner?.logicalName ?? artifact.versionId, artifact.ordinal)
      const disposition = `attachment; filename="${asciiFallbackFilename(filename)}"; filename*=UTF-8''${encodeRfc5987Filename(filename)}`
      return new Response(request.method === 'HEAD' ? null : data.slice(), { headers: {
        'Content-Type': artifact.mediaType, 'Content-Length': String(data.byteLength),
        'Content-Disposition': disposition,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      } })
    } catch (error) {
      if (error instanceof ProjectArtifactStoreError && error.code === 'BLOB_NOT_FOUND') return new Response(null, { status: 410, headers: { 'x-science-artifact-error': 'missing_content' } })
      if (error instanceof ProjectArtifactStoreError && error.code === 'BLOB_CORRUPT') return new Response(null, { status: 409, headers: { 'x-science-artifact-error': 'content_corrupt' } })
      throw error
    }
  }
}
export default ScienceReadService
