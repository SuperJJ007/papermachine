/**
 * Chart editing panel for one addressable live-figure PNG (`chart.chart`
 * present on the artifact version): every extracted `ScienceChartElement`
 * as one list row — display name, current-value summary, one property
 * control per the row's `kind`, and a +/− control that references the exact
 * element into the main composer (`ScienceElementTarget`) — the committed-
 * plus-pending operation list, and Discard/Save actions. The panel carries
 * no image of its own: the single displayed PNG is the caller's
 * `RasterArtifact`, which also hides its manual region drag-select for a
 * chart-bearing version (`ArtifactContent.tsx`). Edits never touch the
 * model: they accumulate as pending `ScienceChartOp`s in this component's
 * own state and Save submits them through the caller-supplied `onSave` (the
 * `applyChartOps` Remote, wired one layer up in `ScienceDetailsView.tsx`'s
 * `ArtifactTab`).
 */

import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceChartElement, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceChartFailedOp } from '@deepseek-ai/dsh-tool-science/types'
import type { ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
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

/** Localized display label for each closed `ScienceChartElement.kind`. */
const ELEMENT_KIND_LABEL_KEY: Record<ScienceChartElement['kind'], ScienceKey> = {
  title: 'panel.kindTitle',
  subtitle: 'panel.kindSubtitle',
  x_label: 'panel.kindXLabel',
  y_label: 'panel.kindYLabel',
  tick_labels: 'panel.kindTickLabels',
  legend: 'panel.kindLegend',
  series: 'panel.kindSeries',
  grid: 'panel.kindGrid',
  axis_range: 'panel.kindAxisRange',
  axis_scale: 'panel.kindAxisScale',
  figure_size: 'panel.kindFigureSize',
  font: 'panel.kindFont',
  annotation: 'panel.kindAnnotation',
}

/** Row display name: the kind's localized label, plus a series/annotation element's own label when it has one. */
function elementDisplayName(element: ScienceChartElement, t: TranslateNS<'science'>): string {
  const kindLabel = t(ELEMENT_KIND_LABEL_KEY[element.kind])
  return element.label === null || element.label === '' ? kindLabel : `${kindLabel} · ${element.label}`
}

/** Compact single-line current-value text for the row summary and the referenced element target. */
function summarizeCurrent(current: unknown): string {
  const text = typeof current === 'string' ? current : JSON.stringify(current)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

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
 * Dispatch one element's `kind` to its one property control (v1's six
 * writable operations, or a read-only current-value display).
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
      return <TextControl onApply={(text) => { onStage({ op: 'set_title', axes: element.axes, text }) }} t={t} />
    case 'x_label':
      return <TextControl onApply={(text) => { onStage({ op: 'set_axis_label', axes: element.axes, axis: 'x', text }) }} t={t} />
    case 'y_label':
      return <TextControl onApply={(text) => { onStage({ op: 'set_axis_label', axes: element.axes, axis: 'y', text }) }} t={t} />
    case 'series': {
      const label = element.label ?? ''
      return <ColorControl onApply={(color) => { onStage({ op: 'set_series_color', axes: element.axes, label, color }) }} t={t} />
    }
    case 'tick_labels':
      return <FontSizeControl onApply={(size) => { onStage({ op: 'set_tick_font_size', axes: element.axes, size }) }} t={t} />
    case 'legend':
      return <LegendControl onApply={(position) => { onStage({ op: 'set_legend_position', axes: element.axes, position }) }} t={t} />
    case 'grid':
      return (
        <ReferenceLineControl
          onApply={(orientation, value) => { onStage({ op: 'add_reference_line', axes: element.axes, orientation, value }) }}
          t={t}
        />
      )
    case 'axis_range':
    case 'axis_scale':
    case 'figure_size':
    case 'font':
    case 'annotation':
      return <ReadOnlyControl current={element.current} t={t} />
    /* v8 ignore next -- closed ScienceChartElement kind union */
    default: return assertNever(kind)
  }
}

/**
 * One `chart.elements` row: display name, current-value summary, the
 * kind-dispatched control, and the +/− composer-reference control shared
 * with `RasterArtifact`'s region row.
 */
function ElementRow({ element, added, onAddTarget, onRemoveTarget, onStage, t }: {
  element: ScienceChartElement
  added: boolean
  onAddTarget: () => void
  onRemoveTarget: () => void
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const name = elementDisplayName(element, t)
  return (
    <li className={css.elementRow}>
      <div className={css.elementRowHead}>
        <strong className={css.editLabel}>{name}</strong>
        <span className={css.elementSummary}>{summarizeCurrent(element.current)}</span>
      </div>
      <ElementControl element={element} onStage={onStage} t={t} />
      <div className={css.elementTargetRow}>
        <button
          type="button"
          className={css.specAdd}
          aria-label={added ? t('edit.removeTarget', { target: name }) : t('edit.addTarget', { target: name })}
          onClick={added ? onRemoveTarget : onAddTarget}
        >
          {added ? '−' : '+'}
        </button>
      </div>
    </li>
  )
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
 * @param props - the chart state, its version, the Save submission
 * callback, and the shared composer-reference callbacks (already scoped to
 * this exact artifact/version one layer up, the same store `RasterArtifact`
 * stages its region target into).
 * @returns the full element list, op list, and Discard/Save actions.
 */
export function ScienceChartEditPanel({ version, chart, onSave, isTargetAdded, onAddTarget, onRemoveTarget, t }: {
  version: number
  chart: ScienceChartState
  onSave: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>
  isTargetAdded: (target: ScienceEditTarget) => boolean
  onAddTarget: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget: (target: ScienceEditTarget) => void
  t: TranslateNS<'science'>
}) {
  const [pending, setPending] = useState<ScienceChartOp[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()
  const [failedOps, setFailedOps] = useState<readonly ScienceChartFailedOp[]>([])

  const stage = (op: ScienceChartOp): void => {
    setPending(current => [...current, op])
    setSaved(false)
    setError(undefined)
    setFailedOps([])
  }

  return (
    <section className={css.elementPanel} aria-label={t('edit.elements')}>
      <h3>{t('style.title')}</h3>
      <ul className={css.elementRows}>
        {chart.elements.map((element) => {
          const target: Extract<ScienceEditTarget, { kind: 'element' }> = {
            kind: 'element', elementId: element.id, elementKind: element.kind, current: summarizeCurrent(element.current),
          }
          const added = isTargetAdded(target)
          return (
            <ElementRow
              key={element.id}
              element={element}
              added={added}
              onAddTarget={() => { onAddTarget(target, '') }}
              onRemoveTarget={() => { onRemoveTarget(target) }}
              onStage={stage}
              t={t}
            />
          )
        })}
      </ul>
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
