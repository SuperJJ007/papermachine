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

import { useEffect, useState } from 'react'
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

/** Debounced ephemeral preview request supplied by the exact open artifact tab. */
export type ScienceChartPreview = (ops: readonly ScienceChartOp[]) => Promise<
  | { readonly ok: true; readonly pngBase64: string; readonly failedOps: readonly ScienceChartFailedOp[] }
  | { readonly ok: false; readonly error: string }
>

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
    case 'set_figure_size': return 'figure_size'
    case 'set_axis_range': return `${prefix}${op.axis}_range`
    case 'set_axis_scale': return `${prefix}${op.axis}_scale`
    case 'toggle_grid': return `${prefix}grid`
    case 'set_font': return `${prefix}font`
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
        <input value={value} placeholder={t('panel.textPlaceholder')} onChange={(event) => {
          setValue(event.target.value)
          if (event.target.value.trim() !== '') onApply(event.target.value)
        }} />
      </label>
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
            onClick={() => { setValue(color); onApply(color) }}
          />
        ))}
        <input type="color" value={value} aria-label={t('style.color')} onChange={(event) => { setValue(event.target.value); onApply(event.target.value) }} />
      </div>
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
        onChange={(event) => { const next = Number(event.target.value); setValue(next); onApply(next) }}
      />
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
            aria-pressed={position === value} onClick={() => { setValue(position); onApply(position) }}
          >
            {t(LEGEND_LABEL_KEY[position])}
          </button>
        ))}
      </div>
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
          aria-pressed={orientation === 'h'} onClick={() => { setOrientation('h'); if (valid) onApply('h', numeric) }}
        >
          {t('panel.orientationHorizontal')}
        </button>
        <button
          type="button" className={css.legendSegment} data-active={orientation === 'v' || undefined}
          aria-pressed={orientation === 'v'} onClick={() => { setOrientation('v'); if (valid) onApply('v', numeric) }}
        >
          {t('panel.orientationVertical')}
        </button>
      </div>
      <label>
        {t('panel.referenceLineValueLabel')}
        <input
          value={value} inputMode="decimal" aria-label={t('panel.referenceLineValueLabel')}
          onChange={(event) => {
            setValue(event.target.value)
            const next = Number(event.target.value)
            if (event.target.value.trim() !== '' && Number.isFinite(next)) onApply(orientation, next)
          }}
        />
      </label>
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

function currentRecord(current: ScienceChartElement['current']): Record<string, unknown> {
  return typeof current === 'object' && current !== null && !Array.isArray(current) ? current : {}
}

function FigureSizeControl({ current, onStage, t }: {
  current: ScienceChartElement['current']
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const initial = Array.isArray(current) ? current : []
  const [width, setWidth] = useState(Number(initial[0] ?? 6))
  const [height, setHeight] = useState(Number(initial[1] ?? 4))
  const stage = (nextWidth: number, nextHeight: number) => {
    if (nextWidth >= 1 && nextWidth <= 100 && nextHeight >= 1 && nextHeight <= 100) {
      onStage({ op: 'set_figure_size', axes: null, width: nextWidth, height: nextHeight })
    }
  }
  return <div className={css.styleControl}>
    <label>{t('panel.figureWidth')}<input type="number" min={1} max={100} value={width} onChange={(event) => {
      const value = Number(event.target.value); setWidth(value); stage(value, height)
    }} /></label>
    <label>{t('panel.figureHeight')}<input type="number" min={1} max={100} value={height} onChange={(event) => {
      const value = Number(event.target.value); setHeight(value); stage(width, value)
    }} /></label>
  </div>
}

function AxisRangeControl({ element, onStage, t }: {
  element: ScienceChartElement
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const current = currentRecord(element.current)
  const initial = (axis: 'x' | 'y') => Array.isArray(current[axis]) ? current[axis] as unknown[] : [0, 1]
  const [values, setValues] = useState(() => ({
    x: [Number(initial('x')[0]), Number(initial('x')[1])],
    y: [Number(initial('y')[0]), Number(initial('y')[1])],
  }))
  const change = (axis: 'x' | 'y', endpoint: 0 | 1, value: number) => {
    const range = [...values[axis]] as [number, number]
    range[endpoint] = value
    setValues(previous => ({ ...previous, [axis]: range }))
    if (Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] < range[1]) {
      onStage({ op: 'set_axis_range', axes: element.axes, axis, min: range[0], max: range[1] })
    }
  }
  return <div className={css.styleControl}>{(['x', 'y'] as const).map(axis => <div key={axis}>
    <span className={css.editLabel}>{axis.toUpperCase()}</span>
    <input aria-label={t('panel.axisMin', { axis: axis.toUpperCase() })} type="number" value={values[axis][0]}
      onChange={(event) => { change(axis, 0, Number(event.target.value)) }} />
    <input aria-label={t('panel.axisMax', { axis: axis.toUpperCase() })} type="number" value={values[axis][1]}
      onChange={(event) => { change(axis, 1, Number(event.target.value)) }} />
  </div>)}</div>
}

function AxisScaleControl({ element, onStage, t }: {
  element: ScienceChartElement
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const current = currentRecord(element.current)
  return <div className={css.styleControl}>{(['x', 'y'] as const).map(axis => <label key={axis}>
    {t('panel.axisScale', { axis: axis.toUpperCase() })}
    <select defaultValue={current[axis] === 'log' ? 'log' : 'linear'} onChange={(event) => {
      onStage({ op: 'set_axis_scale', axes: element.axes, axis, scale: event.target.value as 'linear' | 'log' })
    }}><option value="linear">{t('panel.scaleLinear')}</option><option value="log">{t('panel.scaleLog')}</option></select>
  </label>)}</div>
}

function GridControl({ element, onStage, t }: {
  element: ScienceChartElement
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  return <div className={css.styleControl}>
    <label><input type="checkbox" defaultChecked={element.current === true} onChange={(event) => {
      onStage({ op: 'toggle_grid', axes: element.axes, visible: event.target.checked })
    }} />{t('panel.gridVisible')}</label>
    <ReferenceLineControl onApply={(orientation, value) => {
      onStage({ op: 'add_reference_line', axes: element.axes, orientation, value })
    }} t={t} />
  </div>
}

function FontControl({ element, onStage, t }: {
  element: ScienceChartElement
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const current = currentRecord(element.current)
  const available = Array.isArray(current.available) ? current.available.filter(value => typeof value === 'string') : []
  const firstFamily = Array.isArray(current.family) ? current.family.find(value => typeof value === 'string') : current.family
  const initialFamily = typeof firstFamily === 'string' ? firstFamily : available[0] ?? 'sans'
  const [family, setFamily] = useState(initialFamily)
  const [size, setSize] = useState(typeof current.size === 'number' ? current.size : 12)
  return <div className={css.styleControl}>
    <label>{t('panel.fontFamily')}<select value={family} onChange={(event) => {
      setFamily(event.target.value); onStage({ op: 'set_font', axes: element.axes, family: event.target.value, size })
    }}>{available.includes(family) ? null : <option value={family}>{family}</option>}
      {available.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <label>{t('style.fontSize')} · {size}<input type="range" min={4} max={72} value={size} onChange={(event) => {
      const value = Number(event.target.value); setSize(value); onStage({ op: 'set_font', axes: element.axes, family, size: value })
    }} /></label>
    {current.truncated === true && <span className={css.notice}>{t('panel.fontsTruncated')}</span>}
  </div>
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
    case 'grid': return <GridControl element={element} onStage={onStage} t={t} />
    case 'axis_range': return <AxisRangeControl element={element} onStage={onStage} t={t} />
    case 'axis_scale': return <AxisScaleControl element={element} onStage={onStage} t={t} />
    case 'figure_size': return <FigureSizeControl current={element.current} onStage={onStage} t={t} />
    case 'font': return <FontControl element={element} onStage={onStage} t={t} />
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
function ElementRow({ element, expanded, added, onToggle, onAddTarget, onRemoveTarget, onStage, t }: {
  element: ScienceChartElement
  expanded: boolean
  added: boolean
  onToggle: () => void
  onAddTarget: () => void
  onRemoveTarget: () => void
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const name = elementDisplayName(element, t)
  return (
    <li className={css.elementRow}>
      <div className={css.elementRowHead}>
        <button type="button" className={css.elementToggle} aria-expanded={expanded} onClick={onToggle}>
          <strong className={css.editLabel}>{name}</strong>
          <span className={css.elementSummary}>{summarizeCurrent(element.current)}</span>
        </button>
        <button
          type="button"
          className={css.specAdd}
          aria-label={added ? t('edit.removeTarget', { target: name }) : t('edit.addTarget', { target: name })}
          onClick={added ? onRemoveTarget : onAddTarget}
        >
          {added ? '−' : '+'}
        </button>
      </div>
      {expanded && <ElementControl element={element} onStage={onStage} t={t} />}
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
export function ScienceChartEditPanel({
  version, chart, onSave,
  onPreview,
  onPreviewSrc,
  isTargetAdded, onAddTarget, onRemoveTarget, t,
}: {
  version: number
  chart: ScienceChartState
  onSave: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>
  onPreview?: ScienceChartPreview
  onPreviewSrc?: (src: string | undefined) => void
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
  const [expandedId, setExpandedId] = useState<string>()
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    if (pending.length === 0) {
      setPreviewing(false)
      onPreviewSrc?.(undefined)
      return
    }
    if (onPreview === undefined) {
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      setPreviewing(true)
      void onPreview(pending).then((outcome) => {
        if (!live) return
        if (outcome.ok) {
          onPreviewSrc?.(`data:image/png;base64,${outcome.pngBase64}`)
          setFailedOps(outcome.failedOps)
          setError(undefined)
        } else {
          setError(outcome.error)
        }
      }).finally(() => { if (live) setPreviewing(false) })
    }, 150)
    return () => { live = false; window.clearTimeout(timer) }
  }, [onPreview, onPreviewSrc, pending])

  const stage = (op: ScienceChartOp): void => {
    const key = opTargetLabel(op)
    setPending(current => [...current.filter(existing => opTargetLabel(existing) !== key), op])
    setSaved(false)
    setError(undefined)
    setFailedOps([])
  }

  return (
    <section className={css.elementPanel} aria-label={t('edit.elements')}>
      <h3>{t('style.title')}</h3>
      <ul className={css.elementRows}>
        {chart.elements.filter(element => element.kind !== 'annotation').map((element) => {
          const target: Extract<ScienceEditTarget, { kind: 'element' }> = {
            kind: 'element', elementId: element.id, elementKind: element.kind, current: summarizeCurrent(element.current),
          }
          const added = isTargetAdded(target)
          return (
            <ElementRow
              key={element.id}
              element={element}
              expanded={expandedId === element.id}
              added={added}
              onToggle={() => { setExpandedId(current => current === element.id ? undefined : element.id) }}
              onAddTarget={() => { onAddTarget(target, '') }}
              onRemoveTarget={() => { onRemoveTarget(target) }}
              onStage={stage}
              t={t}
            />
          )
        })}
      </ul>
      <OpsList committed={chart.ops} pending={pending} version={version} t={t} />
      {previewing && <p role="status" className={css.notice}>{t('panel.previewing')}</p>}
      {saved && <p role="status" className={css.notice}>{t('style.committed')}</p>}
      {error !== undefined && <p role="alert" className={css.notice}>{t('style.failed', { message: error })}</p>}
      {failedOps.map(item => (
        <p key={item.index} role="alert" className={css.notice}>{t('panel.failedOp', { index: item.index + 1, reason: item.reason })}</p>
      ))}
      <div className={css.panelActions}>
        <button
          type="button" className={css.regionButton} disabled={pending.length === 0 || saving}
          onClick={() => { setPending([]); onPreviewSrc?.(undefined); setSaved(false); setError(undefined); setFailedOps([]) }}
        >
          {t('panel.discard')}
        </button>
        <button
          type="button" className={css.editSubmit} disabled={pending.length === 0 || saving}
          onClick={() => {
            setSaving(true); setError(undefined); setFailedOps([]); setSaved(false)
            void onSave(pending).then((outcome) => {
              if (outcome.ok) {
                setPending([]); onPreviewSrc?.(undefined); setFailedOps(outcome.failedOps); setSaved(true)
              } else setError(outcome.error)
            }).finally(() => { setSaving(false) })
          }}
        >
          {saving ? t('style.committing') : t('style.commit')}
        </button>
      </div>
    </section>
  )
}
