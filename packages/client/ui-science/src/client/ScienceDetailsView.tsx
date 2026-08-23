// Science Details entry: the artifact viewer over the accepted client-safe
// `science` Session projection (packages/science/science-session/src/types.ts).
// Viewer-first, not a dashboard: a top tab strip holds one tab per opened
// artifact (logical chart); the active tab shows an in-panel toolbar
// (filename, version stepper, provenance, download, maximize [image only],
// close tab) above the dispatched content (ArtifactContent.tsx), or — one
// toolbar click away — the provenance drill-in (ScienceArtifactProvenance.tsx).
// With no open tabs the panel shows the landing view: a gallery of latest
// artifact versions (opening one opens its tab) plus the latest Outcome,
// kept reachable but secondary below the gallery rather than as its own tab,
// since it carries no version history or provenance of its own to navigate.
// It builds no second projection reader, artifact store, or Outcome editor;
// the one piece of local state it owns is the shared ui-science selection
// store (selection-store.ts). Thumbnails and content load through this
// package's own session-scoped loaders (science-attachment-loader.ts) —
// `loadImage` for an image attachment, `loadText` for CSV/JSON/Markdown/
// plain text.
//
// The former resident Environment strip and Runs list are gone: Environment
// facts now live only in the provenance drill-in's Environment sub-tab, per
// artifact version (README "Design notes" explains why no session-wide
// "not applied" notice replaces them). The top-level missing-support/unbound
// states below are unrelated to that strip and are unchanged.

import { useEffect, useState } from 'react'
import { ImageLightbox, MessageImage, type ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment/client'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseFill14, IconCloseOutline16,
  IconDownloadOutline16, IconFullscreenOutline16, IconInspectOutline12, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.details.view,
// and its owner share's inspectCall).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ScienceArtifactId, ScienceClientArtifactVersion, ScienceClientOutcomePublication, ScienceClientProjection,
  ScienceEvidenceRef,
} from '@deepseek-ai/dsh-science-session/types'
import type {
  ScienceEditSelection, ScienceEditTarget, ScienceStyleEditReceipt, ScienceStyleEditRequest,
} from '@deepseek-ai/dsh-tool-science/types'
import { artifactImageLabels, ArtifactContent } from './ArtifactContent.tsx'
import { ArtifactFileTile } from './ArtifactFileTile.tsx'
import { ScienceArtifactProvenance } from './ScienceArtifactProvenance.tsx'
import type { ScienceArtifactView, ScienceOpenArtifact, ScienceProvenanceSubTab, ScienceSelectionStore } from './selection-store.ts'
import type { TextLoader } from './science-attachment-loader.ts'
import css from './ScienceDetailsView.module.css'

/** Business face this entry's registration injects. */
export interface ScienceDetailsInjected {
  /** Session-scoped image artifact loader (science-attachment-loader.ts). */
  loadImage: ImageLoader
  /** Session-scoped text artifact loader (science-attachment-loader.ts). */
  loadText: TextLoader
  /** Add selected artifact elements to the main conversation composer. */
  addToConversation: (targets: readonly ScienceEditSelection[]) => void
  /** Commit a complete styled Vega-Lite working copy over one exact current version. */
  commitStyleEdit: (request: ScienceStyleEditRequest) => Promise<
    | { readonly ok: true; readonly value: ScienceStyleEditReceipt }
    | { readonly ok: false; readonly error: { readonly message: string } }
  >
}

/** Full props for the Science Details entry. */
export type ScienceDetailsViewProps =
  PropsRuntime<'conversation.details.view'> & InjectFace<ScienceDetailsInjected>
  & PropsStore<ScienceSelectionStore> & PropsLocale<'science'>

/** Closed-union exhaustiveness fence. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

function evidenceText(item: ScienceEvidenceRef, t: TranslateNS<'science'>): string {
  switch (item.kind) {
    case 'run': return t('outcome.evidenceRun', { runId: item.runId })
    case 'chart': return t('outcome.evidenceChart', { chartId: item.chartId, version: item.version })
    case 'message': return t('outcome.evidenceMessage', { seq: item.seq })
    /* v8 ignore next -- closed evidence-kind union */
    default: return assertNever(item)
  }
}

/** Latest accepted version per logical artifact, in first-appearance (commit) order. */
function latestArtifacts<T extends ScienceClientArtifactVersion>(artifacts: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const artifact of artifacts) {
    const current = byId.get(artifact.artifactId)
    if (current === undefined || artifact.version > current.version) byId.set(artifact.artifactId, artifact)
  }
  return [...byId.values()]
}

/** Every durable version of one logical artifact, ascending — the version stepper's walk order. */
function versionsOf<T extends ScienceClientArtifactVersion>(artifacts: readonly T[], artifactId: ScienceArtifactId): T[] {
  return artifacts.filter(artifact => artifact.artifactId === artifactId).sort((left, right) => left.version - right.version)
}

/**
 * Filename base without its extension, plus the extension (including the
 * dot). Splits on the last dot, except the two-part `.vl.json` suffix, which
 * stays whole so a version insertion never breaks the suffix the Vega-Lite
 * capture rule keys on.
 */
function splitExtension(name: string): { stem: string; ext: string } {
  if (name.toLowerCase().endsWith('.vl.json') && name.length > '.vl.json'.length) {
    return { stem: name.slice(0, -'.vl.json'.length), ext: name.slice(-'.vl.json'.length) }
  }
  const dot = name.lastIndexOf('.')
  return dot === -1 ? { stem: name, ext: '' } : { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/**
 * The durable browser save name for one artifact version: the attachment's
 * own display name when it has one, else the logical name (already the
 * captured file's real path, extension included) with the version inserted
 * before that extension.
 */
function downloadFilename(chart: ScienceClientArtifactVersion): string {
  if (chart.attachment.name !== undefined) return chart.attachment.name
  const { stem, ext } = splitExtension(chart.logicalName)
  return `${stem}-v${String(chart.version)}${ext}`
}

/** Trigger a browser save of the durable bytes behind one artifact version through a throwaway URI anchor. */
async function downloadArtifact(chart: ScienceClientArtifactVersion, loadImage: ImageLoader, loadText: TextLoader): Promise<void> {
  const { attachment } = chart
  const url = 'width' in attachment
    ? await loadImage(attachment)
    : `data:${attachment.mediaType};charset=utf-8,${encodeURIComponent(await loadText(attachment))}`
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = downloadFilename(chart)
  anchor.click()
}

/**
 * The toolbar-triggered lightbox: a second, store-driven `ImageLightbox`
 * instance alongside the content image's own click-to-open `MessageImage`
 * lightbox. The toolbar's "maximize" button (image artifacts only — see
 * `ArtifactToolbar`) is a sibling of that image with no access to its
 * private open state, so it opens this shared store's `lightboxOpen` flag
 * instead; this component resolves the same durable attachment through the
 * same loader when that flag flips. A load that rejects (or resolves after
 * the flag already closed) renders nothing — the same silent-degrade the
 * thumbnail's own retry control covers for the ordinary click-to-open path.
 */
function ArtifactLightbox({ chart, loadImage, open, onClose, t }: {
  chart: ScienceClientArtifactVersion & { attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }> }
  loadImage: ImageLoader
  open: boolean
  onClose: () => void
  t: TranslateNS<'science'>
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setSrc(null); return }
    let live = true
    void loadImage(chart.attachment).then((url) => { if (live) setSrc(url) }).catch(() => {})
    return () => { live = false }
  }, [open, chart.attachment, loadImage])

  if (!open || src === null) return null
  return (
    <ImageLightbox
      src={src}
      alt={chart.attachment.name ?? t('artifact.title')}
      labels={{ dialog: t('artifact.lightboxOriginal'), close: t('artifact.lightboxClose') }}
      onClose={onClose}
    />
  )
}

function ArtifactToolbar({ chart, versions, onStepVersion, onOpenProvenance, onMaximize, onCloseTab, loadImage, loadText, t }: {
  chart: ScienceClientArtifactVersion
  versions: readonly ScienceClientArtifactVersion[]
  onStepVersion: (version: number) => void
  onOpenProvenance: () => void
  onMaximize: () => void
  onCloseTab: () => void
  loadImage: ImageLoader
  loadText: TextLoader
  t: TranslateNS<'science'>
}) {
  // `chart` is always one of `versions` (the caller resolves it from the same
  // artifactId's version list), so `index` is never -1 — no defensive branch for it.
  const index = versions.findIndex(candidate => candidate.version === chart.version)
  const prev = index > 0 ? versions[index - 1] : undefined
  const next = index < versions.length - 1 ? versions[index + 1] : undefined
  const isImage = 'width' in chart.attachment

  return (
    <div className={css.toolbar}>
      <div className={css.toolbarTitle}>
        <span className={css.chartTitle}>{chart.title}</span>
        {/* An auto-captured file's title is exactly its logical name's
            basename (capture.ts); when the logical name has no directory
            component the two are identical, so the second line is dropped
            rather than repeating the same text. */}
        {chart.title !== chart.logicalName && <span className={css.chartLogicalName}>{chart.logicalName}</span>}
      </div>
      <div className={css.toolbarControls}>
        <div className={css.stepper}>
          <button
            type="button" className={css.stepperButton} disabled={prev === undefined}
            aria-label={t('toolbar.versionPrev')}
            // `disabled` already blocks activation at the boundary; omitting
            // the handler entirely (rather than a no-op runtime guard) keeps
            // every branch here reachable by a real click.
            onClick={prev === undefined ? undefined : () => { onStepVersion(prev.version) }}
          >
            <IconChevronLeftOutline14 size={12} />
          </button>
          <span className={css.stepperLabel}>{t('artifact.version', { version: chart.version })}</span>
          <button
            type="button" className={css.stepperButton} disabled={next === undefined}
            aria-label={t('toolbar.versionNext')}
            onClick={next === undefined ? undefined : () => { onStepVersion(next.version) }}
          >
            <IconChevronRightOutline14 size={12} />
          </button>
        </div>
        <button type="button" className={css.toolbarAction} aria-label={t('details.artifact.provenance')} onClick={onOpenProvenance}>
          <IconInspectOutline12 size={12} />
        </button>
        <button
          type="button" className={css.toolbarAction} aria-label={t('toolbar.download')}
          onClick={() => { void downloadArtifact(chart, loadImage, loadText).catch(() => {}) }}
        >
          <IconDownloadOutline16 size={14} />
        </button>
        {/* Maximize opens the shared image lightbox; a text attachment has no
            raster to maximize, so this control is image-only. */}
        {isImage && (
          <button type="button" className={css.toolbarAction} aria-label={t('details.artifact.expand')} onClick={onMaximize}>
            <IconFullscreenOutline16 size={14} />
          </button>
        )}
        <button type="button" className={css.toolbarAction} aria-label={t('toolbar.closeTab')} onClick={onCloseTab}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
    </div>
  )
}

function TabStrip({ tabs, artifacts, activeArtifactId, onActivate, onClose, t }: {
  tabs: readonly ScienceOpenArtifact[]
  artifacts: readonly ScienceClientArtifactVersion[]
  activeArtifactId: ScienceArtifactId | null
  onActivate: (artifactId: ScienceArtifactId) => void
  onClose: (artifactId: ScienceArtifactId) => void
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.tabStrip} role="tablist" aria-label={t('toolbar.openArtifacts')}>
      {tabs.map((tab) => {
        const artifact = artifacts.find(candidate => candidate.artifactId === tab.artifactId && candidate.version === tab.version)
        const label = artifact?.title ?? tab.artifactId
        const active = tab.artifactId === activeArtifactId
        return (
          <div key={tab.artifactId} className={active ? `${css.tab} ${css.tabActive}` : css.tab}>
            <button type="button" role="tab" aria-selected={active} className={css.tabButton} onClick={() => { onActivate(tab.artifactId) }}>
              {label}
            </button>
            <button
              type="button" className={css.tabClose} aria-label={t('toolbar.closeNamedTab', { title: label })}
              onClick={() => { onClose(tab.artifactId) }}
            >
              <IconCloseFill14 size={10} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function ArtifactGallery({ artifacts, loadImage, onOpen, t }: {
  artifacts: readonly ScienceClientArtifactVersion[]
  loadImage: ImageLoader
  onOpen: (selection: { artifactId: ScienceArtifactId; version: number }) => void
  t: TranslateNS<'science'>
}) {
  const latest = latestArtifacts(artifacts)
  if (latest.length === 0) return <p className={css.notice} role="status">{t('details.artifacts.empty')}</p>
  return (
    <ul className={css.chartList}>
      {latest.map((artifact) => {
        const { attachment } = artifact
        return (
          <li key={artifact.artifactId} className={css.chartItem}>
            {/* A real <button> wrapping MessageImage's own thumbnail <button>
                is invalid HTML that also breaks click delivery (a nested
                button swallows clicks meant for its ancestor, even from a
                sibling outside the inner button — proven by this exact
                structure in this package's own tests); a div with a button
                role is the same pattern ScienceArtifactRow's row uses. */}
            {/* An explicit label: without it this role="button" wrapper's
                accessible name is computed from its contents, which include
                MessageImage's own button — so the wrapper would announce (and
                match by role+name as) whatever state that thumbnail is in. */}
            <div
              className={css.galleryButton}
              role="button"
              aria-label={t('details.artifact.select', { title: artifact.title, version: artifact.version })}
              tabIndex={0}
              onClick={() => { onOpen({ artifactId: artifact.artifactId, version: artifact.version }) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpen({ artifactId: artifact.artifactId, version: artifact.version })
              }}
            >
              {'width' in attachment
                ? <MessageImageTile attachment={attachment} loadImage={loadImage} t={t} />
                : <ArtifactFileTile mediaType={attachment.mediaType} />}
              <div className={css.chartMeta}>
                <span className={css.chartTitle}>{artifact.title}</span>
                <span className={css.chartLogicalName}>{artifact.logicalName}</span>
                <span className={css.badge}>{t('artifact.version', { version: artifact.version })}</span>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Thin `MessageImage` wrapper isolating the `variant`/`labels` construction the gallery's `tile` thumbnails share. */
function MessageImageTile({ attachment, loadImage, t }: {
  attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }>
  loadImage: ImageLoader
  t: TranslateNS<'science'>
}) {
  return (
    <MessageImage
      attachment={attachment}
      load={loadImage}
      variant="tile"
      labels={artifactImageLabels(t)}
    />
  )
}

function OutcomeSection({ outcome, t }: {
  outcome: ScienceClientOutcomePublication | null
  t: TranslateNS<'science'>
}) {
  return (
    <section className={css.section}>
      <div className={css.sectionLabel}>{t('outcome.title')}</div>
      {outcome === null
        ? <p className={css.notice} role="status">{t('details.outcome.empty')}</p>
        : (
          <div className={css.outcomeBody}>
            <div className={css.outcomeHead}>
              <span className={css.outcomeTitle}>{outcome.title}</span>
              <span className={css.badge}>{t('outcome.revision', { revision: outcome.revision })}</span>
            </div>
            <MarkdownText text={outcome.summaryMarkdown} />
            {outcome.evidence.length > 0 && (
              <ul className={css.evidenceList}>
                {outcome.evidence.map((item, index) => <li key={index}>{evidenceText(item, t)}</li>)}
              </ul>
            )}
          </div>
        )}
    </section>
  )
}

/** No open tabs: a gallery of latest artifact versions (opening one opens its tab), plus the Outcome kept reachable below it. */
function LandingView({ artifacts, outcome, loadImage, onOpenTab, t }: {
  artifacts: readonly ScienceClientArtifactVersion[]
  outcome: ScienceClientOutcomePublication | null
  loadImage: ImageLoader
  onOpenTab: (selection: { artifactId: ScienceArtifactId; version: number }) => void
  t: TranslateNS<'science'>
}) {
  return (
    <div className={css.landing}>
      <section className={css.section}>
        <div className={css.sectionLabel}>{t('details.artifacts.title')}</div>
        <ArtifactGallery artifacts={artifacts} loadImage={loadImage} onOpen={onOpenTab} t={t} />
      </section>
      <OutcomeSection outcome={outcome} t={t} />
    </div>
  )
}

/** One open tab's body: the toolbar plus dispatched content, or — one toolbar click away — the provenance drill-in. */
function ArtifactTab({
  science, artifacts, chart, view, provenanceSubTab, snapshot, loadImage, loadText,
  addToConversation, commitStyleEdit, useStore, actions, inspectCall, t,
}: {
  science: ScienceClientProjection
  artifacts: readonly ScienceClientArtifactVersion[]
  chart: ScienceClientArtifactVersion
  view: ScienceArtifactView
  provenanceSubTab: ScienceProvenanceSubTab
  snapshot: ConversationSnapshot
  loadImage: ImageLoader
  loadText: TextLoader
  addToConversation: ScienceDetailsInjected['addToConversation']
  commitStyleEdit: ScienceDetailsInjected['commitStyleEdit']
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  inspectCall: (callId: string) => void
  t: TranslateNS<'science'>
}) {
  const lightboxOpen = useStore(s => s.lightboxOpen)
  const versions = versionsOf(artifacts, chart.artifactId)
  const [target, setTarget] = useState<ScienceEditTarget | undefined>(undefined)
  const [selectedTargets, setSelectedTargets] = useState<ScienceEditTarget[]>([])
  // The version a style commit just produced, not reset by the
  // artifactId/version effect below: a successful commit itself changes
  // `chart.version` to this same value, and the effect would otherwise wipe
  // the flag in the same render pass that is supposed to show it. Equality
  // with the current `chart.version` is what stops showing it once the
  // reader steps to a different version instead.
  const [committedVersion, setCommittedVersion] = useState<number | undefined>(undefined)

  useEffect(() => {
    setTarget(undefined)
    setSelectedTargets([])
  }, [chart.artifactId, chart.version])

  const selectTarget = (next: ScienceEditTarget): void => {
    setTarget(next)
    setSelectedTargets(current => current.some(candidate => JSON.stringify(candidate) === JSON.stringify(next))
      ? current.filter(candidate => JSON.stringify(candidate) !== JSON.stringify(next))
      : [...current, next])
    setCommittedVersion(undefined)
  }

  if (view === 'provenance') {
    if (chart.origin === 'human-edit') {
      return (
        <div className={css.body}>
          <nav className={css.breadcrumb} aria-label={t('provenance.label')}>
            <button type="button" className={css.breadcrumbRoot} onClick={() => { actions.setView('content') }}>
              {chart.title}
            </button>
            <span className={css.breadcrumbSep} aria-hidden="true">›</span>
            <span className={css.breadcrumbCurrent}>{t('provenance.label')}</span>
          </nav>
          <section className={css.editPanel}>
            <strong>{t('artifact.humanEdit', { version: chart.parent.version })}</strong>
            <span>{chart.artifactId} v{String(chart.version)}</span>
          </section>
        </div>
      )
    }
    const run = science.runs.find(candidate => candidate.runId === chart.runId)
    if (run === undefined) return <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
    return (
      <ScienceArtifactProvenance
        chart={chart}
        run={run}
        environment={science.environment}
        snapshot={snapshot}
        subTab={provenanceSubTab}
        onSubTabChange={(subTab) => { actions.setProvenanceSubTab(subTab) }}
        onBack={() => { actions.setView('content') }}
        inspectCall={inspectCall}
        t={t}
      />
    )
  }

  return (
    <>
      <ArtifactToolbar
        chart={chart}
        versions={versions}
        onStepVersion={(version) => { actions.setTabVersion({ artifactId: chart.artifactId, version }) }}
        onOpenProvenance={() => { actions.setView('provenance') }}
        onMaximize={() => { actions.setLightboxOpen(true) }}
        onCloseTab={() => { actions.closeTab(chart.artifactId) }}
        loadImage={loadImage}
        loadText={loadText}
        t={t}
      />
      <ArtifactContent
        chart={chart}
        loadImage={loadImage}
        loadText={loadText}
        selectionTarget={target}
        onSelectTarget={selectTarget}
        onCommitStyle={async (spec) => {
          const result = await commitStyleEdit({ artifactId: chart.artifactId, version: chart.version, spec })
          if (!result.ok) return { ok: false, error: result.error.message }
          actions.setTabVersion({ artifactId: result.value.artifactId, version: result.value.version })
          setCommittedVersion(result.value.version)
          return { ok: true }
        }}
        t={t}
      />
      {selectedTargets.length > 0 && (
        <section className={css.selectedPanel} aria-label={t('edit.selectedTargets')}>
          <div className={css.selectedChips}>
            {selectedTargets.map((selected, index) => {
              const label = selected.kind === 'spec-path'
                ? selected.path
                : t('edit.regionTarget', {
                  x: Math.round(selected.x * 100), y: Math.round(selected.y * 100),
                })
              return (
                <button
                  type="button" className={css.selectedChip} key={`${label}:${String(index)}`}
                  onClick={() => { setSelectedTargets(current => current.filter((_, candidate) => candidate !== index)) }}
                >
                  {label} ×
                </button>
              )
            })}
          </div>
          <button type="button" className={css.addToConversation} onClick={() => {
            addToConversation(selectedTargets.map(selected => ({
              artifactId: chart.artifactId, version: chart.version, target: selected,
            })))
            setSelectedTargets([])
            setTarget(undefined)
          }}>
            {t('edit.addToConversation')}
          </button>
        </section>
      )}
      {committedVersion === chart.version && <p className={css.notice} role="status">{t('style.committed')}</p>}
      {'width' in chart.attachment && (
        <ArtifactLightbox
          chart={chart as ScienceClientArtifactVersion & { attachment: Extract<ScienceClientArtifactVersion['attachment'], { width: number }> }}
          loadImage={loadImage}
          open={lightboxOpen}
          onClose={() => { actions.setLightboxOpen(false) }}
          t={t}
        />
      )}
    </>
  )
}

function ArtifactViewer({ science, snapshot, loadImage, loadText, addToConversation, commitStyleEdit, useStore, actions, inspectCall, t }: {
  science: ScienceClientProjection
  snapshot: ConversationSnapshot
  loadImage: ImageLoader
  loadText: TextLoader
  addToConversation: ScienceDetailsInjected['addToConversation']
  commitStyleEdit: ScienceDetailsInjected['commitStyleEdit']
  useStore: ScienceDetailsViewProps['useStore']
  actions: ScienceDetailsViewProps['actions']
  inspectCall: (callId: string) => void
  t: TranslateNS<'science'>
}) {
  const openArtifacts = useStore(s => s.openArtifacts)
  const activeArtifactId = useStore(s => s.activeArtifactId)
  const view = useStore(s => s.view)
  const provenanceSubTab = useStore(s => s.provenanceSubTab)
  const artifacts = science.artifacts

  // Every selection-store action maintains one invariant
  // (selection-store.client.spec.ts): activeArtifactId is null iff
  // openArtifacts is empty, otherwise it names an entry in openArtifacts —
  // so `activeTab === undefined` here means exactly "no open tabs", the
  // landing view's gate, without a second, separately-tracked emptiness
  // check on `openArtifacts.length`.
  const activeTab = openArtifacts.find(tab => tab.artifactId === activeArtifactId)
  if (activeTab === undefined) {
    return (
      <div className={css.body}>
        <LandingView
          artifacts={artifacts}
          outcome={science.outcome}
          loadImage={loadImage}
          onOpenTab={(selection) => { actions.openTab(selection) }}
          t={t}
        />
      </div>
    )
  }

  // The one remaining way `activeChart` resolves to undefined is the
  // durable projection not having this exact (artifactId, version) pair — a
  // stale tab, handled below as "artifact unavailable".
  const activeChart = artifacts.find(candidate =>
    candidate.artifactId === activeTab.artifactId && candidate.version === activeTab.version)

  return (
    <div className={css.body}>
      <TabStrip
        tabs={openArtifacts}
        artifacts={artifacts}
        activeArtifactId={activeArtifactId}
        onActivate={(artifactId) => { actions.activateTab(artifactId) }}
        onClose={(artifactId) => { actions.closeTab(artifactId) }}
        t={t}
      />
      {activeChart === undefined
        ? <p className={css.notice} role="status">{t('provenance.artifactUnavailable')}</p>
        : (
          <ArtifactTab
            science={science}
            artifacts={artifacts}
            chart={activeChart}
            view={view}
            provenanceSubTab={provenanceSubTab}
            snapshot={snapshot}
            loadImage={loadImage}
            loadText={loadText}
            addToConversation={addToConversation}
            commitStyleEdit={commitStyleEdit}
            useStore={useStore}
            actions={actions}
            inspectCall={inspectCall}
            t={t}
          />
        )}
    </div>
  )
}

/**
 * Render the Science Details entry (the artifact viewer) from the current
 * `science` projection and the shared selection store.
 * @param props - runtime slot currency, the injected loaders, the shared
 * selection store, the Details-seam jump handoff, and the science locale seat.
 * @returns the current-state Science surface for this session.
 */
export function ScienceDetailsView({
  sessionId, useSessions, useSession, useProjection, useStore, actions,
  inspectCall, loadImage, loadText, addToConversation, commitStyleEdit, t,
}: ScienceDetailsViewProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const science = useProjection('science')
  const snapshot = useSession(s => s)

  if (science === undefined) {
    return (
      <div className={css.body}>
        <p className={css.notice} role="status">{t('details.missingSupport')}</p>
      </div>
    )
  }

  if (science === null) {
    return (
      <div className={css.body}>
        {preset !== undefined && <p className={css.preset}>{t('details.preset', { preset })}</p>}
        <p className={css.notice} role="status">{t('details.unbound')}</p>
      </div>
    )
  }

  return (
    <ArtifactViewer
      science={science} snapshot={snapshot} loadImage={loadImage} loadText={loadText}
      addToConversation={addToConversation} commitStyleEdit={commitStyleEdit}
      useStore={useStore} actions={actions} inspectCall={inspectCall} t={t}
    />
  )
}
