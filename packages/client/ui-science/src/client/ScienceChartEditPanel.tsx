/** Compact chart controls and precise composer references for one addressable PNG. */

import { Fragment, useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceChartElement, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceChartFailedOp, ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
import { scienceElementCurrentSummary } from '@deepseek-ai/dsh-tool-science/element-summary'
import type { ScienceKey } from './locales.ts'
import { scienceElementColor, scienceElementLabel } from './science-element-label.ts'
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

/** Closed-union exhaustiveness fence. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a value is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`)
}

const LEGEND_POSITIONS = ['best', 'right', 'upper left', 'upper right', 'lower left', 'lower right', 'center'] as const
type LegendPosition = typeof LEGEND_POSITIONS[number]

const LEGEND_LABEL_KEY: Record<LegendPosition, ScienceKey> = {
  best: 'panel.legendBest',
  right: 'panel.legendRight',
  'upper left': 'panel.legendUpperLeft',
  'upper right': 'panel.legendUpperRight',
  'lower left': 'panel.legendLowerLeft',
  'lower right': 'panel.legendLowerRight',
  center: 'panel.legendCenter',
}

const FONT_FAMILIES = [
  'sans-serif', 'serif', 'monospace', 'DejaVu Sans', 'Arial', 'Helvetica', 'Times New Roman', 'PingFang SC',
  'Hiragino Sans GB', 'Songti SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'SimHei',
] as const

/** matplotlib's numeric `Legend._loc` code, mapped to the seven-value control. */
const MPL_LOC_POSITION: Readonly<Record<number, LegendPosition>> = {
  0: 'best', 1: 'upper right', 2: 'upper left', 3: 'lower left', 4: 'lower right', 5: 'right', 10: 'center',
}

/** ggplot2 inside coordinates represented by the seven-value control. */
const R_INSIDE_POSITION: readonly (readonly [x: number, y: number, position: LegendPosition])[] = [
  [0, 1, 'upper left'], [1, 1, 'upper right'], [0, 0, 'lower left'], [1, 0, 'lower right'], [0.5, 0.5, 'center'],
]

/** Derive the legend control value from one adapter's extracted current value. */
function legendControlInitial(current: ScienceChartElement['current']): LegendPosition | undefined {
  if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
  const record = current as Record<string, unknown>
  const loc = record['loc']
  if (typeof loc === 'number') return MPL_LOC_POSITION[loc]
  const position = record['position']
  if (position === 'right') return 'right'
  if (position !== 'inside') return undefined
  const inside = record['inside']
  if (!Array.isArray(inside) || inside.length !== 2) return undefined
  const [x, y] = inside as [unknown, unknown]
  return R_INSIDE_POSITION.find(([mx, my]) => Math.abs(Number(x) - mx) < 1e-6 && Math.abs(Number(y) - my) < 1e-6)?.[2]
}

function opTargetLabel(op: ScienceChartOp, multiAxes: boolean, t: TranslateNS<'science'>): string {
  const prefix = multiAxes && op.axes !== null ? `${t('panel.panelSuffix', { index: op.axes + 1 })} · ` : ''
  switch (op.op) {
    case 'set_title': return `${prefix}${t('panel.kindTitle')}`
    case 'set_axis_label': return `${prefix}${t(op.axis === 'x' ? 'panel.kindXLabel' : 'panel.kindYLabel')}`
    case 'set_legend_position': return `${prefix}${t('panel.kindLegend')}`
    case 'toggle_grid': return `${prefix}${t('panel.kindGrid')}`
    case 'set_font': return t('panel.kindFont')
    /* v8 ignore next -- closed ScienceChartOp union */
    default: return assertNever(op)
  }
}

/** Element kinds with compact, always-visible direct controls. */
type DirectEditKind = 'title' | 'subtitle' | 'x_label' | 'y_label' | 'grid' | 'font' | 'legend'

function directlyEditable(kind: ScienceChartElement['kind']): kind is DirectEditKind {
  switch (kind) {
    case 'title':
    case 'subtitle':
    case 'x_label':
    case 'y_label':
    case 'grid':
    case 'font':
    case 'legend': return true
    case 'tick_labels':
    case 'series':
    case 'axis_range':
    case 'axis_scale':
    case 'figure_size':
    case 'annotation': return false
    /* v8 ignore next -- closed ScienceChartElement kind union */
    default: return assertNever(kind)
  }
}

/** Direct-edit order follows the compact form from top to bottom. */
const DIRECT_EDIT_ROW_ORDER: readonly DirectEditKind[] = ['title', 'subtitle', 'x_label', 'y_label', 'legend', 'grid', 'font']

function directEditRows(elements: readonly ScienceChartElement[]): readonly (ScienceChartElement & { kind: DirectEditKind })[] {
  return elements
    .map((element, index) => ({ element, index }))
    .filter((item): item is {
      element: ScienceChartElement & { kind: DirectEditKind }
      index: number
    } => directlyEditable(item.element.kind))
    .sort((left, right) => (left.element.axes ?? -1) - (right.element.axes ?? -1)
      || DIRECT_EDIT_ROW_ORDER.indexOf(left.element.kind) - DIRECT_EDIT_ROW_ORDER.indexOf(right.element.kind)
      || left.index - right.index)
    .map(({ element }) => element)
}

function elementTarget(element: ScienceChartElement): Extract<ScienceEditTarget, { kind: 'element' }> {
  return {
    kind: 'element',
    elementId: element.id,
    elementKind: element.kind,
    axes: element.axes,
    label: element.label,
    current: scienceElementCurrentSummary(element.current),
  }
}

function referenceButtonLabel(element: ScienceChartElement, added: boolean, t: TranslateNS<'science'>): string {
  const name = scienceElementLabel(element.kind, element.label, t, element.id.startsWith('axes[') && element.axes !== null ? element.axes + 1 : undefined, element.current, element.id)
  return added ? t('edit.removeTarget', { target: name }) : t('edit.addTarget', { target: name })
}

function TextControl({ initial, onApply, t }: {
  initial: string
  onApply: (text: string) => void
  t: TranslateNS<'science'>
}) {
  const [value, setValue] = useState(initial)
  return <input type="text" value={value} aria-label={t('panel.textPlaceholder')} onChange={(event) => {
    setValue(event.target.value)
    if (event.target.value.trim() !== '') onApply(event.target.value)
  }} />
}

function LegendControl({ current, onApply, t }: {
  current: ScienceChartElement['current']
  onApply: (position: LegendPosition) => void
  t: TranslateNS<'science'>
}) {
  const initial = legendControlInitial(current)
  const [value, setValue] = useState<LegendPosition | ''>(initial ?? '')
  return <select aria-label={t('panel.legendPositionLabel')} value={value} onChange={(event) => {
    const position = event.target.value as LegendPosition
    setValue(position)
    onApply(position)
  }}>
    {initial === undefined && <option value="" disabled>{t('panel.legendCurrent', { current: scienceElementCurrentSummary(current) })}</option>}
    {LEGEND_POSITIONS.map(position => <option key={position} value={position}>{t(LEGEND_LABEL_KEY[position])}</option>)}
  </select>
}

function fontInitial(current: ScienceChartElement['current']): { family: string; size: number } {
  if (typeof current !== 'object' || current === null || Array.isArray(current)) return { family: 'sans-serif', size: 10 }
  const record = current as Record<string, unknown>
  const families = record['family']
  const family = typeof families === 'string' ? families
    : Array.isArray(families) && typeof families[0] === 'string' ? families[0]
      : 'sans-serif'
  return { family: family.trim() === '' ? 'sans-serif' : family, size: typeof record['size'] === 'number' ? record['size'] : 10 }
}

function FontControl({ element, onStage, t }: {
  element: ScienceChartElement
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const initial = fontInitial(element.current)
  const [family, setFamily] = useState(initial.family)
  const [size, setSize] = useState(initial.size)
  const datalistId = `science-font-families-${element.id.replace(/[^A-Za-z0-9_-]/g, '-')}`
  const stage = (nextFamily: string, nextSize: number): void => {
    onStage({ op: 'set_font', axes: null, family: nextFamily.trim() === '' ? initial.family : nextFamily, size: nextSize })
  }
  return <div className={css.fontControls}>
    <input list={datalistId} value={family} aria-label={t('panel.fontFamily')} onChange={(event) => {
      setFamily(event.target.value)
      stage(event.target.value, size)
    }} />
    <datalist id={datalistId}>{FONT_FAMILIES.map(candidate => <option key={candidate} value={candidate} />)}</datalist>
    <input type="number" min={4} max={72} step={1} value={size} aria-label={t('panel.fontSize')} onChange={(event) => {
      const next = event.target.valueAsNumber
      if (!Number.isFinite(next) || next < 4 || next > 72) return
      setSize(next)
      stage(family, next)
    }} />
  </div>
}

function ElementControl({ element, onStage, t }: {
  element: ScienceChartElement & { kind: DirectEditKind }
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  switch (element.kind) {
    case 'title':
    case 'subtitle':
      return <TextControl initial={typeof element.current === 'string' ? element.current : ''}
        onApply={(text) => { onStage({ op: 'set_title', axes: element.axes, text }) }} t={t} />
    case 'x_label':
      return <TextControl initial={typeof element.current === 'string' ? element.current : ''}
        onApply={(text) => { onStage({ op: 'set_axis_label', axes: element.axes, axis: 'x', text }) }} t={t} />
    case 'y_label':
      return <TextControl initial={typeof element.current === 'string' ? element.current : ''}
        onApply={(text) => { onStage({ op: 'set_axis_label', axes: element.axes, axis: 'y', text }) }} t={t} />
    case 'grid':
      return <label className={css.gridControl}><input type="checkbox" defaultChecked={element.current === true} onChange={(event) => {
        onStage({ op: 'toggle_grid', axes: element.axes, visible: event.target.checked })
      }} />{t('panel.gridVisible')}</label>
    case 'font': return <FontControl element={element} onStage={onStage} t={t} />
    case 'legend':
      return <LegendControl current={element.current}
        onApply={(position) => { onStage({ op: 'set_legend_position', axes: element.axes, position }) }} t={t} />
    /* v8 ignore next -- closed DirectEditKind union */
    default: return assertNever(element.kind)
  }
}

function DirectEditRow({ element, added, onAddTarget, onRemoveTarget, onStage, onInspect, disabled, t }: {
  element: ScienceChartElement & { kind: DirectEditKind }
  added: boolean
  disabled: boolean
  onInspect: () => void
  onAddTarget: () => void
  onRemoveTarget: () => void
  onStage: (op: ScienceChartOp) => void
  t: TranslateNS<'science'>
}) {
  const label = scienceElementLabel(element.kind, null, t)
  return <li onMouseEnter={onInspect} onFocusCapture={onInspect} className={css.directEditRow} data-editable="true" data-selected={added || undefined}>
    <span className={css.directEditName}>{label}</span>
    <ElementControl element={element} onStage={onStage} t={t} />
    <button type="button" className={css.elementReference} data-selected={added || undefined}
      aria-label={referenceButtonLabel(element, added, t)} aria-pressed={added} disabled={disabled && !added}
      onClick={added ? onRemoveTarget : onAddTarget}>{added ? '−' : '+'}</button>
  </li>
}


function ReferenceChip({ element, added, onAddTarget, onRemoveTarget, onInspect, disabled, t }: {
  element: ScienceChartElement
  added: boolean
  disabled: boolean
  onInspect: () => void
  onAddTarget: () => void
  onRemoveTarget: () => void
  t: TranslateNS<'science'>
}) {
  const color = scienceElementColor(element.current)
  return <li onMouseEnter={onInspect} onFocusCapture={onInspect} data-selected={added || undefined}>
    <button type="button" className={css.referenceChip} data-selected={added || undefined}
      aria-label={referenceButtonLabel(element, added, t)} aria-pressed={added} disabled={disabled && !added}
      onClick={added ? onRemoveTarget : onAddTarget}>
      <span className={css.elementKindDot} style={color === undefined ? undefined : { backgroundColor: color }} aria-hidden="true" />
      <span>{scienceElementLabel(element.kind, element.label, t, element.id.startsWith('axes[') && element.axes !== null ? element.axes + 1 : undefined, element.current, element.id)}</span>
      {color !== undefined && <span className={css.referenceChipSummary}>{color}</span>}
      <span aria-hidden="true">{added ? '−' : '+'}</span>
    </button>
  </li>
}

function OpsList({ committed, pending, version, multiAxes, t }: {
  committed: readonly ScienceChartOp[]
  pending: readonly ScienceChartOp[]
  version: number
  multiAxes: boolean
  t: TranslateNS<'science'>
}) {
  if (committed.length === 0 && pending.length === 0) return null
  return <div className={css.opsSection}>
    {committed.length > 0 && <details className={css.committedOps}>
      <summary>{t('panel.committedOpsSummary', { count: committed.length, version })}</summary>
      <ul className={css.opsList}>{committed.map((op, index) => <li key={index}>{op.op} → {opTargetLabel(op, multiAxes, t)}</li>)}</ul>
    </details>}
    {pending.length > 0 && <p className={css.pendingOps}>
      {t('panel.pendingOpsSummary', { count: pending.length, ops: pending.map(op => op.op).join(', ') })}
    </p>}
  </div>
}

/** Render compact direct controls and reference-only chips for one exact chart version. */
export function ScienceChartEditPanel({
  version, chart, onSave, onPreview, onPreviewSrc, isTargetAdded, onAddTarget, onRemoveTarget, onPendingChange,
  onInspectElement, referencesDisabled = false, t,
}: {
  version: number
  /** Highlight the matching region of the committed PNG. */
  onInspectElement?: (id: string) => void
  /** The displayed preview has no committed reference identity yet. */
  referencesDisabled?: boolean
  chart: ScienceChartState
  onSave: (ops: readonly ScienceChartOp[]) => Promise<ScienceChartSaveOutcome>
  onPreview?: ScienceChartPreview
  onPreviewSrc?: (src: string | undefined) => void
  isTargetAdded: (target: ScienceEditTarget) => boolean
  onAddTarget: (target: ScienceEditTarget, comment: string) => void
  onRemoveTarget: (target: ScienceEditTarget) => void
  /** Report whether unsaved direct operations should suppress automatic version stepping. */
  onPendingChange?: (hasPending: boolean) => void
  t: TranslateNS<'science'>
}) {
  const [pending, setPending] = useState<ScienceChartOp[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()
  const [failedOps, setFailedOps] = useState<readonly ScienceChartFailedOp[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [annotationsExpanded, setAnnotationsExpanded] = useState(false)

  useEffect(() => {
    onPendingChange?.(pending.length > 0)
  }, [pending, onPendingChange])

  useEffect(() => {
    if (pending.length === 0) {
      setPreviewing(false)
      onPreviewSrc?.(undefined)
      return
    }
    if (onPreview === undefined) return
    let live = true
    const timer = window.setTimeout(() => {
      setPreviewing(true)
      void onPreview(pending).then((outcome) => {
        if (!live) return
        if (outcome.ok) {
          onPreviewSrc?.(`data:image/png;base64,${outcome.pngBase64}`)
          setFailedOps(outcome.failedOps)
          setError(undefined)
        } else setError(outcome.error)
      }).finally(() => { if (live) setPreviewing(false) })
    }, 150)
    return () => { live = false; window.clearTimeout(timer) }
  }, [onPreview, onPreviewSrc, pending])

  const stage = (op: ScienceChartOp): void => {
    const key = opTargetLabel(op, true, t)
    setPending(current => [...current.filter(existing => opTargetLabel(existing, true, t) !== key), op])
    setSaved(false)
    setError(undefined)
    setFailedOps([])
  }

  const direct = directEditRows(chart.elements)
  const multiAxes = new Set(direct.filter(element => element.axes !== null).map(element => element.axes)).size >= 2
  let annotationIndex = 0
  const references = chart.elements.filter((element) => {
    if (directlyEditable(element.kind)) return false
    if (element.kind !== 'annotation') return true
    annotationIndex += 1
    return annotationsExpanded || annotationIndex <= 6
  })
  const hiddenAnnotations = chart.elements.filter(element => element.kind === 'annotation').length - 6

  const targetProps = (element: ScienceChartElement) => {
    const target = elementTarget(element)
    const added = isTargetAdded(target)
    return {
      added,
      onAddTarget: () => { onAddTarget(target, '') },
      onRemoveTarget: () => { onRemoveTarget(target) },
    }
  }

  return <section className={css.elementPanel} aria-label={t('edit.elements')}>
    <p className={css.notice}>{t('panel.locateHelp')}</p>
    <div className={css.elementPanelColumns}>
      <section className={css.elementPanelSection} aria-labelledby="science-direct-edit-heading">
        <h4 id="science-direct-edit-heading">{t('edit.elements')}</h4>
        <ul className={css.directEditRows}>{direct.map((element, index) => <Fragment key={element.id}>
          {multiAxes && element.axes !== null && direct[index - 1]?.axes !== element.axes
            && <li className={css.directEditHeading}>{t('panel.panelHeading', { index: element.axes + 1 })}</li>}
          <DirectEditRow element={element} {...targetProps(element)} onStage={stage} t={t}
            onInspect={() => { onInspectElement?.(element.id) }} disabled={referencesDisabled || pending.length > 0} />
        </Fragment>)}</ul>
      </section>
      <section className={css.elementPanelSection} aria-labelledby="science-reference-heading">
        <h4 id="science-reference-heading">{t('panel.referenceEdit')}</h4>
        <ul className={css.referenceChips}>{references.map(element => <ReferenceChip key={element.id} element={element}
          {...targetProps(element)} t={t} onInspect={() => { onInspectElement?.(element.id) }}
          disabled={referencesDisabled || pending.length > 0} />)}
        {hiddenAnnotations > 0 && <li><button type="button" className={css.referenceChip}
          aria-expanded={annotationsExpanded} onClick={() => { setAnnotationsExpanded(value => !value) }}>
          <span className={css.elementKindDot} data-kind="annotation" aria-hidden="true" />
          {annotationsExpanded ? t('panel.annotationsCollapse') : t('panel.annotationsMore', { count: hiddenAnnotations })}
        </button></li>}
        </ul>
      </section>
    </div>
    <OpsList committed={chart.ops} pending={pending} version={version} multiAxes={multiAxes} t={t} />
    {previewing && <p role="status" className={css.notice}>{t('panel.previewing')}</p>}
    {saved && <p role="status" className={css.notice}>{t('style.committed')}</p>}
    {error !== undefined && <p role="alert" className={css.notice}>{t('style.failed', { message: error })}</p>}
    {failedOps.map(item => <p key={item.index} role="alert" className={css.notice}>
      {t('panel.failedOp', { index: item.index + 1, reason: item.reason === 'font_not_found' ? t('panel.fontNotFound') : item.reason })}
    </p>)}
    <div className={css.panelActions}>
      <button type="button" className={css.regionButton} disabled={pending.length === 0 || saving}
        onClick={() => { setPending([]); onPreviewSrc?.(undefined); setSaved(false); setError(undefined); setFailedOps([]) }}>
        {t('panel.discard')}
      </button>
      <button type="button" className={css.editSubmit} disabled={pending.length === 0 || saving} onClick={() => {
        setSaving(true); setError(undefined); setFailedOps([]); setSaved(false)
        void onSave(pending).then((outcome) => {
          if (outcome.ok) {
            setPending([]); onPreviewSrc?.(undefined); setFailedOps(outcome.failedOps); setSaved(true)
          } else setError(outcome.error)
        }).finally(() => { setSaving(false) })
      }}>
        {saving ? t('style.committing') : t('style.commit')}
      </button>
    </div>
  </section>
}
