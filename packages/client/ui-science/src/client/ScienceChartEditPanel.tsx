/** Chart editing and precise composer references for one addressable PNG. */

import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceChartElement, ScienceChartOp, ScienceChartState } from '@deepseek-ai/dsh-science-session/types'
import type { ScienceChartFailedOp, ScienceEditTarget } from '@deepseek-ai/dsh-tool-science/types'
import { scienceElementCurrentSummary } from '@deepseek-ai/dsh-tool-science/element-summary'
import type { ScienceKey } from './locales.ts'
import { scienceElementLabel } from './science-element-label.ts'
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

/** matplotlib's numeric `Legend._loc` code, mapped to the segment it names. Codes with no segment (6/7/8/9) are absent. */
const MPL_LOC_POSITION: Readonly<Record<number, LegendPosition>> = {
  0: 'best', 1: 'upper right', 2: 'upper left', 3: 'lower left', 4: 'lower right', 5: 'right', 10: 'center',
}

/**
 * ggplot2's `legend.position.inside` normalized coordinate, mapped to the
 * segment it names (see A1's placement table). center-left, center-right,
 * upper-center, and lower-center have no matching segment among the 7.
 */
const R_INSIDE_POSITION: readonly (readonly [x: number, y: number, position: LegendPosition])[] = [
  [0, 1, 'upper left'], [1, 1, 'upper right'], [0, 0, 'lower left'], [1, 0, 'lower right'], [0.5, 0.5, 'center'],
]

/**
 * Derive the legend control's initial highlighted segment from one legend
 * element's extracted `current` value (matplotlib's numeric `loc`, or
 * ggplot2's `position`/`inside` pair — see A1's extraction shapes).
 * @param current - the legend element's extracted current value.
 * @returns the matching segment, or `undefined` when `current` matches none of the seven.
 */
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

function opTargetLabel(op: ScienceChartOp): string {
  const prefix = op.axes === null ? '' : `axes[${String(op.axes)}].`
  switch (op.op) {
    case 'set_title': return `${prefix}title`
    case 'set_axis_label': return `${prefix}${op.axis}_label`
    case 'set_legend_position': return `${prefix}legend`
    case 'toggle_grid': return `${prefix}grid`
    /* v8 ignore next -- closed ScienceChartOp union */
    default: return assertNever(op)
  }
}

function directlyEditable(kind: ScienceChartElement['kind']): boolean {
  switch (kind) {
    case 'title':
    case 'subtitle':
    case 'x_label':
    case 'y_label':
    case 'legend':
    case 'grid': return true
    case 'tick_labels':
    case 'series':
    case 'axis_range':
    case 'axis_scale':
    case 'figure_size':
    case 'font':
    case 'annotation': return false
    /* v8 ignore next -- closed ScienceChartElement kind union */
    default: return assertNever(kind)
  }
}

/** Row order for the directly-editable kinds; every other kind sorts after them, in extraction order. */
const DIRECT_EDIT_ROW_ORDER: readonly ScienceChartElement['kind'][] = ['title', 'subtitle', 'x_label', 'y_label', 'legend', 'grid']

/**
 * Order chart elements for the panel's row list: directly-editable kinds
 * first (in {@link DIRECT_EDIT_ROW_ORDER}, ties broken by ascending axes),
 * then every other kind in the extraction order the Runtime produced —
 * never reordered among themselves. Does not mutate `elements`.
 * @param elements - the exact chart version's extracted elements.
 * @returns the same elements, reordered for display.
 */
function sortedElementRows(elements: readonly ScienceChartElement[]): readonly ScienceChartElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((left, right) => {
      const leftRank = DIRECT_EDIT_ROW_ORDER.indexOf(left.element.kind)
      const rightRank = DIRECT_EDIT_ROW_ORDER.indexOf(right.element.kind)
      if (leftRank !== -1 && rightRank !== -1) {
        return leftRank - rightRank || (left.element.axes ?? -1) - (right.element.axes ?? -1) || left.index - right.index
      }
      if (leftRank !== -1) return -1
      if (rightRank !== -1) return 1
      return left.index - right.index
    })
    .map(({ element }) => element)
}

function TextControl({ initial, onApply, t }: {
  initial: string
  onApply: (text: string) => void
  t: TranslateNS<'science'>
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className={css.styleControl}>
      <label>
        {t('panel.textPlaceholder')}
        <input value={value} aria-label={t('panel.textPlaceholder')} onChange={(event) => {
          setValue(event.target.value)
          if (event.target.value.trim() !== '') onApply(event.target.value)
        }} />
      </label>
    </div>
  )
}

function LegendControl({ initial, onApply, t }: {
  initial: LegendPosition | undefined
  onApply: (position: LegendPosition) => void
  t: TranslateNS<'science'>
}) {
  const [value, setValue] = useState<LegendPosition | undefined>(initial)
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

function ElementControl({ element, onStage, t }: {
  element: ScienceChartElement
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
    case 'legend':
      return <LegendControl initial={legendControlInitial(element.current)}
        onApply={(position) => { onStage({ op: 'set_legend_position', axes: element.axes, position }) }} t={t} />
    case 'grid':
      return <div className={css.styleControl}><label className={css.gridControl}><input
        type="checkbox" defaultChecked={element.current === true} onChange={(event) => {
          onStage({ op: 'toggle_grid', axes: element.axes, visible: event.target.checked })
        }} />{t('panel.gridVisible')}</label></div>
    case 'tick_labels':
    case 'series':
    case 'axis_range':
    case 'axis_scale':
    case 'figure_size':
    case 'font':
    case 'annotation': return null
    /* v8 ignore next -- closed ScienceChartElement kind union */
    default: return assertNever(element.kind)
  }
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
  const editable = directlyEditable(element.kind)
  const name = scienceElementLabel(element.kind, element.label, t)
  const toggleReference = added ? onRemoveTarget : onAddTarget
  return (
    <li className={css.elementRow} data-selected={added || undefined} data-editable={editable || undefined}>
      <div className={css.elementRowHead}>
        <button
          type="button" className={css.elementToggle}
          {...editable ? { 'aria-expanded': expanded, onClick: onToggle } : { 'aria-pressed': added, onClick: toggleReference }}
        >
          <span className={css.elementKindDot} data-kind={element.kind} aria-hidden="true" />
          <span className={css.elementIdentity}>
            <strong className={css.elementName}>{name}</strong>
            <span className={css.elementSummary}>{scienceElementCurrentSummary(element.current)}</span>
          </span>
          {editable && <span className={css.elementChevron} aria-hidden="true">›</span>}
        </button>
        <button
          type="button" className={css.elementReference} data-selected={added || undefined}
          aria-label={added ? t('edit.removeTarget', { target: name }) : t('edit.addTarget', { target: name })}
          aria-pressed={added} onClick={toggleReference}
        >
          {added ? '−' : '+'}
        </button>
      </div>
      {editable && expanded && <ElementControl element={element} onStage={onStage} t={t} />}
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
      {committed.length > 0 && <div>
        <h4 className={css.editLabel}>{t('panel.committedOpsHeading', { version })}</h4>
        <ul className={css.opsList}>{committed.map((op, index) => <li key={index}>{op.op} → {opTargetLabel(op)}</li>)}</ul>
      </div>}
      {pending.length > 0 && <div>
        <h4 className={css.editLabel}>{t('panel.pendingOpsHeading')}</h4>
        <ul className={css.opsList}>{pending.map((op, index) => <li key={index}>{op.op} → {opTargetLabel(op)}</li>)}</ul>
      </div>}
    </div>
  )
}

/**
 * Render every extracted element with a precise composer reference; only
 * titles, axis labels, legend position, and grid expose direct controls and
 * live preview.
 * @param props - exact chart version, operation callbacks, and composer-reference callbacks.
 * @returns element rows, pending operation status, and explicit Discard/Save actions.
 */
export function ScienceChartEditPanel({
  version, chart, onSave, onPreview, onPreviewSrc, isTargetAdded, onAddTarget, onRemoveTarget, t,
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
    const key = opTargetLabel(op)
    setPending(current => [...current.filter(existing => opTargetLabel(existing) !== key), op])
    setSaved(false)
    setError(undefined)
    setFailedOps([])
  }

  return (
    <section className={css.elementPanel} aria-label={t('edit.elements')}>
      <h3>{t('edit.elements')}</h3>
      <ul className={css.elementRows}>{sortedElementRows(chart.elements).map((element) => {
        const target = elementTarget(element)
        const added = isTargetAdded(target)
        return <ElementRow key={element.id} element={element} expanded={expandedId === element.id} added={added}
          onToggle={() => { setExpandedId(current => current === element.id ? undefined : element.id) }}
          onAddTarget={() => { onAddTarget(target, '') }} onRemoveTarget={() => { onRemoveTarget(target) }} onStage={stage} t={t} />
      })}</ul>
      <OpsList committed={chart.ops} pending={pending} version={version} t={t} />
      {previewing && <p role="status" className={css.notice}>{t('panel.previewing')}</p>}
      {saved && <p role="status" className={css.notice}>{t('style.committed')}</p>}
      {error !== undefined && <p role="alert" className={css.notice}>{t('style.failed', { message: error })}</p>}
      {failedOps.map(item => <p key={item.index} role="alert" className={css.notice}>
        {t('panel.failedOp', { index: item.index + 1, reason: item.reason })}
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
  )
}
