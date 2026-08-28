/**
 * Chart editing panel for one addressable live-figure PNG (`chart.chart`
 * present on the artifact version): a canvas rendering the same PNG with a
 * hitmap-derived click overlay (or, when the hitmap is unavailable, an
 * element list) to pick one `ScienceChartElement`, one property control per
 * the selected element's `kind`, the committed-plus-pending operation list,
 * and Discard/Save actions. Edits never touch the model: they accumulate as
 * pending `ScienceChartOp`s in this component's own state and Save submits
 * them through the caller-supplied `onSave` (the `applyChartOps` Remote,
 * wired one layer up in `ScienceDetailsView.tsx`'s `ArtifactTab`).
 */

import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceChartElement, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceChartFailedOp } from '@deepseek-ai/dsh-tool-science/types'
import type { ScienceArtifactContentRef, ScienceImageLoader } from './science-attachment-loader.ts'
import type { ScienceKey } from './locales.ts'
import css from './ScienceDetailsView.module.css'

/** Result of one Save attempt: the committed receipt's unresolved-op list, or a rejection message. */
export type ScienceChartSaveOutcome =
  | { readonly ok: true; readonly failedOps: readonly ScienceChartFailedOp[] }
  | { readonly ok: false; readonly error: string }

/** Closed-union exhaustiveness fence (package-local copy; see ArtifactContent.tsx / ScienceDetailsView.tsx). */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

/** Closed 6-value subset of `set_legend_position`'s position enum offered by the segmented control. */
const LEGEND_POSITIONS = ['best', 'upper left', 'upper right', 'lower left', 'lower right', 'center'] as const
type LegendPosition = typeof LEGEND_POSITIONS[number]

const LEGEND_LABEL_KEY: Record<LegendPosition, ScienceKey> = {
  best: 'panel.legendBest',
  'upper left': 'panel.legendUpperLeft',
  'upper right': 'panel.legendUpperRight',
  'lower left': 'panel.legendLowerLeft',
  'lower right': 'panel.legendLowerRight',
  center: 'panel.legendCenter',
}

/** Fixed preset palette for the series color control; a native color input covers every other value. */
const COLOR_PRESETS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'] as const

/**
 * Derive a display target path for one operation, matching the kernel
 * adapters' `axes[i].kind[label]` id convention closely enough for the
 * committed/pending op list — a display convenience, not a data key.
 */
function opTargetLabel(op: ScienceChartOp): string {
  const prefix = op.axes === null ? '' : `axes[${String(op.axes)}].`
  switch (op.op) {
    case 'set_title': return `${prefix}title`
    case 'set_axis_label': return `${prefix}${op.axis}_label`
    case 'set_series_color': return `${prefix}series[${op.label}]`
    case 'set_legend_position': return `${prefix}legend`
    case 'set_tick_font_size': return `${prefix}tick_labels`
    case 'add_reference_line': return `${prefix}grid`
    /* v8 ignore next -- closed ScienceChartOp union */
    default: return assertNever(op)
  }
}

/** Load one displayable image URL for `content`, re-fetching only when the version changes. */
function useLoadedImageSrc(content: ScienceArtifactContentRef, loadImage: ScienceImageLoader): string | undefined {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let live = true
    setSrc(undefined)
    void loadImage(content).then((url) => { if (live) setSrc(url) }).catch(() => {})
    return () => { live = false }
  }, [content.versionId, loadImage])
  return src
}

/** Canvas with a hitmap click overlay (`hitmapStatus: 'ok'`), or a plain element list otherwise. */
function ElementPicker({ chart, content, loadImage, selectedId, onSelect, t }: {
  chart: ScienceChartState
  content: ScienceArtifactContentRef
  loadImage: ScienceImageLoader
  selectedId: string | undefined
  onSelect: (id: string) => void
  t: TranslateNS<'science'>
}) {
  const src = useLoadedImageSrc(content, loadImage)
  return (
    <div className={css.chartPicker} aria-label={t('edit.specTargets')}>
      <div className={css.chartCanvas}>
        {src === undefined
          ? <span className={css.notice} role="status">{t('artifact.loading')}</span>
          : <img className={css.chartCanvasImage} src={src} alt="" />}
        {chart.hitmapStatus === 'ok' && src !== undefined && (
          <div className={css.chartHitLayer}>
            {chart.hitmap.map((hit) => {
              const [x0, y0, x1, y1] = hit.bbox
              const active = hit.id === selectedId
              return (
                <button
                  key={hit.id}
                  type="button"
                  className={css.chartHit}
                  data-active={active || undefined}
                  style={{
                    left: `${String((x0 / chart.png.width) * 100)}%`,
                    top: `${String((y0 / chart.png.height) * 100)}%`,
                    width: `${String(((x1 - x0) / chart.png.width) * 100)}%`,
                    height: `${String(((y1 - y0) / chart.png.height) * 100)}%`,
                    zIndex: hit.z,
                  }}
                  aria-pressed={active}
                  aria-label={hit.id}
                  onClick={() => { onSelect(hit.id) }}
                />
              )
            })}
          </div>
        )}
      </div>
      {chart.hitmapStatus === 'unavailable' && (
        <ul className={css.chartElementList}>
          {chart.elements.map(element => (
            <li key={element.id}>
              <button
                type="button"
                className={css.chartElementItem}
                data-active={element.id === selectedId || undefined}
                aria-pressed={element.id === selectedId}
                onClick={() => { onSelect(element.id) }}
              >
                {element.id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TextControl({ onApply, t }: { onApply: (text: string) => void; t: TranslateNS<'science'> }) {
  const [value, setValue] = useState('')
  return (
    <div className={css.styleControl}>
      <label>
        {t('panel.textPlaceholder')}
        <input value={value} placeholder={t('panel.textPlaceholder')} onChange={(event) => { setValue(event.target.value) }} />
      </label>
      <button
        type="button" className={css.editSubmit} disabled={value.trim() === ''}
        onClick={() => { onApply(value.trim()); setValue('') }}
      >
        {t('panel.addChange')}
      </button>
    </div>
  )
}

function ColorControl({ onApply, t }: { onApply: (color: string) => void; t: TranslateNS<'science'> }) {
  const [value, setValue] = useState<string>(COLOR_PRESETS[0])
  return (
    <div className={css.styleControl}>
      <span className={css.editLabel}>{t('style.color')}</span>
      <div className={css.colorSwatches}>
        {COLOR_PRESETS.map(color => (
          <button
            key={color} type="button" className={css.colorSwatch} data-active={color === value || undefined}
            style={{ background: color }} aria-label={t('panel.colorSwatch', { color })} aria-pressed={color === value}
            onClick={() => { setValue(color) }}
          />
        ))}
        <input type="color" value={value} aria-label={t('style.color')} onChange={(event) => { setValue(event.target.value) }} />
      </div>
      <button type="button" className={css.editSubmit} onClick={() => { onApply(value) }}>{t('panel.addChange')}</button>
    </div>
  )
}

function FontSizeControl({ onApply, t }: { onApply: (size: number) => void; t: TranslateNS<'science'> }) {
  const [value, setValue] = useState(12)
  return (
    <div className={css.styleControl}>
      <span className={css.editLabel}>{t('style.fontSize')} · {value}</span>
      <input
        type="range" min={4} max={72} value={value} aria-label={t('panel.fontSizeInput')}
        onChange={(event) => { setValue(Number(event.target.value)) }}
      />
      <button type="button" className={css.editSubmit} onClick={() => { onApply(value) }}>{t('panel.addChange')}</button>
    </div>
  )
}

function LegendControl({ onApply, t }: { onApply: (position: LegendPosition) => void; t: TranslateNS<'science'> }) {
  const [value, setValue] = useState<LegendPosition>('best')
  return (
    <div className={css.styleControl}>
      <span className={css.editLabel}>{t('panel.legendPositionLabel')}</span>
      <div className={css.legendSegments} role="radiogroup" aria-label={t('panel.legendPositionLabel')}>
        {LEGEND_POSITIONS.map(position => (
          <button
            key={position} type="button" className={css.legendSegment} data-active={position === value || undefined}
            aria-pressed={position === value} onClick={() => { setValue(position) }}
          >
            {t(LEGEND_LABEL_KEY[position])}
          </button>
        ))}
      </div>
      <button type="button" className={css.editSubmit} onClick={() => { onApply(value) }}>{t('panel.addChange')}</button>
    </div>
  )
}

function ReferenceLineControl({ onApply, t }: {
  onApply: (orientation: 'h' | 'v', value: number) => void
  t: TranslateNS<'science'>
}) {
  const [orientation, setOrientation] = useState<'h' | 'v'>('h')
  const [value, setValue] = useState('')
  const numeric = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(numeric)
  return (
    <div className={css.styleControl}>
      <span className={css.editLabel}>{t('panel.referenceLineOrientationLabel')}</span>
      <div className={css.legendSegments} role="radiogroup" aria-label={t('panel.referenceLineOrientationLabel')}>
        <button
          type="button" className={css.legendSegment} data-active={orientation === 'h' || undefined}
          aria-pressed={orientation === 'h'} onClick={() => { setOrientation('h') }}
        >
          {t('panel.orientationHorizontal')}
        </button>
        <button
          type="button" className={css.legendSegment} data-active={orientation === 'v' || undefined}
          aria-pressed={orientation === 'v'} onClick={() => { setOrientation('v') }}
        >
          {t('panel.orientationVertical')}
        </button>
      </div>
      <label>
        {t('panel.referenceLineValueLabel')}
        <input
          value={value} inputMode="decimal" aria-label={t('panel.referenceLineValueLabel')}
          onChange={(event) => { setValue(event.target.value) }}
        />
      </label>
      <button
        type="button" className={css.editSubmit} disabled={!valid}
        onClick={() => { onApply(orientation, numeric); setValue('') }}
      >
        {t('panel.addChange')}
      </button>
    </div>
  )
}

function ReadOnlyControl({ current, t }: { current: unknown; t: TranslateNS<'science'> }) {
  return (
    <div className={css.styleControl}>
      <span className={css.editLabel}>{t('panel.currentValueLabel')}</span>
      <code className={css.readOnlyValue}>{JSON.stringify(current)}</code>
      <p className={css.notice}>{t('panel.readOnlyNotice')}</p>
    </div>
  )
}

/**
 * Dispatch the selected element's `kind` to its one property control (v1's
 * six writable operations, or a read-only current-value display).
 */
function ElementControl({ element, onStage, t }: {
  element: ScienceChartElement
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const kind = element.kind
  switch (kind) {
    case 'title':
    case 'subtitle':
      return (
        <TextControl key={element.id} onApply={(text) => { onStage({ op: 'set_title', axes: element.axes, text }) }} t={t} />
      )
    case 'x_label':
      return (
        <TextControl
          key={element.id}
          onApply={(text) => { onStage({ op: 'set_axis_label', axes: element.axes, axis: 'x', text }) }} t={t}
        />
      )
    case 'y_label':
      return (
        <TextControl
          key={element.id}
          onApply={(text) => { onStage({ op: 'set_axis_label', axes: element.axes, axis: 'y', text }) }} t={t}
        />
      )
    case 'series': {
      const label = element.label ?? ''
      return (
        <ColorControl
          key={element.id}
          onApply={(color) => { onStage({ op: 'set_series_color', axes: element.axes, label, color }) }} t={t}
        />
      )
    }
    case 'tick_labels':
      return (
        <FontSizeControl key={element.id} onApply={(size) => { onStage({ op: 'set_tick_font_size', axes: element.axes, size }) }} t={t} />
      )
    case 'legend':
      return (
        <LegendControl
          key={element.id}
          onApply={(position) => { onStage({ op: 'set_legend_position', axes: element.axes, position }) }} t={t}
        />
      )
    case 'grid':
      return (
        <ReferenceLineControl
          key={element.id}
          onApply={(orientation, value) => { onStage({ op: 'add_reference_line', axes: element.axes, orientation, value }) }}
          t={t}
        />
      )
    case 'axis_range':
    case 'axis_scale':
    case 'figure_size':
    case 'font':
    case 'annotation':
      return <ReadOnlyControl key={element.id} current={element.current} t={t} />
    /* v8 ignore next -- closed ScienceChartElement kind union */
    default: return assertNever(kind)
  }
}

function OpsList({ committed, pending, version, t }: {
  committed: readonly ScienceChartOp[]
  pending: readonly ScienceChartOp[]
  version: number
  t: TranslateNS<'science'>
}) {
  if (committed.length === 0 && pending.length === 0) return null
  return (
    <div className={css.opsSection}>
      {committed.length > 0 && (
        <div>
          <h4 className={css.editLabel}>{t('panel.committedOpsHeading', { version })}</h4>
          <ul className={css.opsList}>{committed.map((op, index) => <li key={index}>{op.op} → {opTargetLabel(op)}</li>)}</ul>
        </div>
      )}
      {pending.length > 0 && (
        <div>
          <h4 className={css.editLabel}>{t('panel.pendingOpsHeading')}</h4>
          <ul className={css.opsList}>{pending.map((op, index) => <li key={index}>{op.op} → {opTargetLabel(op)}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

/**
 * Render the chart editing panel for one addressable chart version.
 * @param props - the chart state, its version and content reference, image
 * loading, and the Save submission callback (already scoped to this exact
 * artifact/version one layer up).
 * @returns the picker/properties two-column section, op list, and actions.
 */
export function ScienceChartEditPanel({ version, chart, content, loadImage, onSave, t }: {
  version: number
  chart: ScienceChartState
  content: ScienceArtifactContentRef
  loadImage: ScienceImageLoader
  onSave: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>
  t: TranslateNS<'science'>
}) {
  const [selectedId, setSelectedId] = useState<string>()
  const [pending, setPending] = useState<ScienceChartOp[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()
  const [failedOps, setFailedOps] = useState<readonly ScienceChartFailedOp[]>([])

  const selected = chart.elements.find(element => element.id === selectedId)

  const stage = (op: ScienceChartOp): void => {
    setPending(current => [...current, op])
    setSaved(false)
    setError(undefined)
    setFailedOps([])
  }

  return (
    <section className={css.elementPanel} aria-label={t('edit.elements')}>
      <h3>{t('style.title')}</h3>
      <div className={css.stylePanel}>
        <ElementPicker chart={chart} content={content} loadImage={loadImage} selectedId={selectedId} onSelect={setSelectedId} t={t} />
        <div className={css.styleControl}>
          {selected === undefined
            ? <p className={css.notice}>{t('panel.selectPrompt')}</p>
            : <>
              <strong className={css.editLabel}>{selected.id}</strong>
              <ElementControl element={selected} onStage={stage} t={t} />
            </>}
        </div>
      </div>
      <OpsList committed={chart.ops} pending={pending} version={version} t={t} />
      {saved && <p role="status" className={css.notice}>{t('style.committed')}</p>}
      {error !== undefined && <p role="alert" className={css.notice}>{t('style.failed', { message: error })}</p>}
      {failedOps.map(item => (
        <p key={item.index} role="alert" className={css.notice}>{t('panel.failedOp', { index: item.index + 1, reason: item.reason })}</p>
      ))}
      <div className={css.panelActions}>
        <button
          type="button" className={css.regionButton} disabled={pending.length === 0 || saving}
          onClick={() => { setPending([]); setSaved(false); setError(undefined); setFailedOps([]) }}
        >
          {t('panel.discard')}
        </button>
        <button
          type="button" className={css.editSubmit} disabled={pending.length === 0 || saving}
          onClick={() => {
            setSaving(true); setError(undefined); setFailedOps([]); setSaved(false)
            void onSave(pending).then((outcome) => {
              if (outcome.ok) { setPending([]); setFailedOps(outcome.failedOps); setSaved(true) } else setError(outcome.error)
            }).finally(() => { setSaving(false) })
          }}
        >
          {saving ? t('style.committing') : t('style.commit')}
        </button>
      </div>
    </section>
  )
}
