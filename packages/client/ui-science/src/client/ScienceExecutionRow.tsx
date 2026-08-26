/**
 * The `run_python`/`run_r` transcript row: eight presentation states over
 * one status header, driven entirely from the durable tool-call slice and
 * the joined `science` Session projection run entry — never a new Host
 * fact. Table/chart artifacts captured by a run never render a chip here;
 * every captured artifact surfaces once, in the Turn-tail artifact group
 * (`ScienceTurnArtifacts`).
 */

import { useEffect, useState, type ReactNode } from 'react'
import { formatBytes } from '@deepseek-ai/dsh-byte-size'
import { IconChevronDownOutline14, IconCodeOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
// Merges the `science` key into SessionProjectionMap for useProjection.
import type { ScienceClientRun } from '@deepseek-ai/dsh-science-session/types'
import { ScienceToolCell } from './ScienceToolCell.tsx'
import { scienceToolResultText, scienceToolRowState } from './ScienceToolFallbackRow.tsx'
import {
  byteLength, countLines, firstLine, formatElapsed, formatSeconds, splitRunResultSections,
} from './run-output.ts'
import type { RunOutputSections } from './run-output.ts'
import css from './ScienceExecutionRow.module.css'

/** stdout at or below this line count renders in full; above it folds behind a caret. */
const SHORT_OUTPUT_MAX_LINES = 8
/** Trailing stderr lines shown as the failed row's tail-first summary, before expansion. */
const ERROR_TAIL_LINES = 2

/** Capability this row needs beyond the standard toolview runtime share. */
export interface ScienceExecutionRowInjected {
  /** Stop the active turn — the same whole-turn control the composer's own Stop button drives. */
  cancel: () => void
}

type ScienceExecutionRowProps = ToolCallViewProps & PropsLocale<'science'> & InjectFace<ScienceExecutionRowInjected>
type Translate = ScienceExecutionRowProps['t']

/**
 * Extract the durable `code` argument from a settled call's head, falling
 * back to the raw JSON for a non-standard shape. Only `FallbackRow` calls
 * this, and only with a settled result (`state==='running'` always renders
 * `RunningRow` instead), so this takes the settled call head directly rather
 * than the whole running-or-settled union.
 */
function sourceOf(call: { readonly argsRaw: string } | null | undefined): string {
  const raw = call?.argsRaw ?? ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const code = (parsed as Record<string, unknown>).code
      if (typeof code === 'string') return code
    }
  } catch {
    // Malformed tool JSON can only arrive from the durable/wire edge; show it verbatim.
  }
  return raw
}

/**
 * Narrow to the settled call shape `FallbackRow` requires. Both call sites
 * only reach this after checking `state !== 'running'`, and
 * `scienceToolRowState` returns `'running'` exactly when the block is
 * unsettled, so a running block here would mean that invariant broke.
 */
function requireSettled(
  block: ScienceExecutionRowProps['block'],
): Extract<ScienceExecutionRowProps['block'], { kind: 'tool-result' }> {
  /* v8 ignore next 2 -- see the function doc: state !== 'running' already proves this at both call sites. */
  if (!('kind' in block)) throw new Error('science-run: FallbackRow requires a settled call')
  return block
}

/** Fold toggle: chevron + label, matching the shared disclosure caret language. */
function FoldButton({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={css.foldButton} onClick={onToggle} aria-expanded={open}>
      <span className={css.foldCaret} data-open={open || undefined}><IconChevronDownOutline14 /></span>
      {label}
    </button>
  )
}

/** Shared status header: state dot, title, status text, and an optional trailing slot. */
function RunHeader({ dot, title, status, statusClassName, trailing }: {
  dot: 'ongoing' | 'done' | 'error' | 'warning'
  title: string
  status: string
  statusClassName?: string | undefined
  trailing?: ReactNode
}) {
  return (
    <div className={css.header}>
      <StateDot state={dot} size={7} className={css.dot} />
      <span className={css.title}>{title}</span>
      <span className={statusClassName ?? css.status}>{status}</span>
      {trailing}
    </div>
  )
}

/** State 1: running — live mm:ss elapsed, a degraded static summary (no streaming stdout channel exists), and a turn-level Stop. */
function RunningRow({ title, startedAt, cancel, t }: { title: string; startedAt: number; cancel: () => void; t: Translate }) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt)
  useEffect(() => {
    const id = window.setInterval(() => { setElapsedMs(Date.now() - startedAt) }, 1_000)
    return () => { window.clearInterval(id) }
  }, [startedAt])
  return (
    <div className={css.root} data-science-cell data-tool="science-run" data-state="running">
      <RunHeader dot="ongoing" title={title} status={t('run.elapsed', { elapsed: formatElapsed(elapsedMs) })}
        trailing={<button type="button" className={css.interrupt} onClick={cancel}>{t('run.interrupt')}</button>} />
      <div className={css.staticSummary}>{t('run.runningPlaceholder')}</div>
    </div>
  )
}

/** States 2/3/4/5/8: a settled successful run, folded or truncated per its retained stdout. */
function SuccessRow({ title, kernelEpoch, durationMs, sections, truncated, t }: {
  title: string
  kernelEpoch: number
  durationMs: number
  sections: RunOutputSections
  truncated: boolean
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  const lineCount = countLines(sections.stdout)
  const bytes = byteLength(sections.stdout)
  const toggle = () => { setOpen(value => !value) }
  const badge = <span className={css.kernelBadge}>{t('run.kernel', { epoch: kernelEpoch })}</span>
  const body = truncated
    ? (
      <>
        <FoldButton label={t('run.stdoutTruncatedFold', { size: formatBytes(bytes) })} open={open} onToggle={toggle} />
        {open && <pre className={`${css.output} ${css.scrollable}`}>{sections.stdout}</pre>}
        <div className={css.truncatedNotice}>{t('run.truncatedNotice')}</div>
      </>
    )
    : lineCount === 0
      ? null
      : lineCount <= SHORT_OUTPUT_MAX_LINES
        ? <pre className={css.output}>{sections.stdout}</pre>
        : (
          <>
            <FoldButton label={t('run.stdoutFold', { lines: lineCount, size: formatBytes(bytes) })} open={open} onToggle={toggle} />
            {open && <pre className={`${css.output} ${css.scrollable}`}>{sections.stdout}</pre>}
          </>
        )
  return (
    <div className={css.root} data-science-cell data-tool="science-run" data-state="success">
      <RunHeader dot="done" title={title} status={t('run.succeeded', { duration: formatSeconds(durationMs) })} trailing={badge} />
      {body}
    </div>
  )
}

/** State 6: a settled non-kernel-death failure — tail-first stderr summary, full stack behind a fold. */
function FailedRow({ title, kernelEpoch, sections, t }: {
  title: string
  kernelEpoch: number
  sections: RunOutputSections
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  const stderrLines = countLines(sections.stderr)
  const tail = sections.stderr === '' ? '' : sections.stderr
    .split('\n').slice(-ERROR_TAIL_LINES).join('\n')
  const badge = <span className={css.kernelBadge}>{t('run.kernel', { epoch: kernelEpoch })}</span>
  return (
    <div className={css.root} data-science-cell data-tool="science-run" data-state="failed">
      <RunHeader dot="error" title={title} status={t('run.failedStatus')} statusClassName={css.statusError} trailing={badge} />
      {tail !== '' && <pre className={css.errorTail}>{tail}</pre>}
      {stderrLines > 0 && (
        <>
          <FoldButton label={t('run.fullTraceFold', { lines: stderrLines })} open={open} onToggle={() => { setOpen(v => !v) }} />
          {open && <pre className={`${css.output} ${css.scrollable}`}>{sections.stderr}</pre>}
        </>
      )}
    </div>
  )
}

/** State 7: the kernel driving this run exited mid-execution — session/turn continues, only this kernel is gone. */
function KernelDiedRow({ title, kernelEpoch, inspect, t }: {
  title: string
  kernelEpoch: number
  inspect: (() => void) | undefined
  t: Translate
}) {
  return (
    <div className={css.root} data-science-cell data-tool="science-run" data-state="kernel-died">
      <RunHeader dot="warning" title={title} status={t('run.kernelExited.status')} statusClassName={css.statusWarn} />
      <p className={css.explain}>{t('run.kernelExited.explain', { epoch: kernelEpoch, nextEpoch: kernelEpoch + 1 })}</p>
      {inspect !== undefined && (
        <button type="button" className={css.viewReason} onClick={inspect}>{t('run.kernelExited.viewReason')}</button>
      )}
    </div>
  )
}

/**
 * Plain fallback shared by three cases this row does not model as one of the
 * eight science-specific states: a genuine tool-level exception, a
 * turn/session interruption landing mid-call, and a settled call whose
 * flattened text does not carry `formatRunResult`'s fixed section markers
 * (no science Session projection entry, or a hand-built non-standard
 * fixture) — never invented, always the same collapsed code+output cell
 * this row used before the eight-state redesign.
 */
function FallbackRow({ block, toolName, state, inspect, copyLabel, copiedLabel, t }: {
  block: Extract<ScienceExecutionRowProps['block'], { kind: 'tool-result' }>
  toolName: string
  state: Exclude<ReturnType<typeof scienceToolRowState>, 'running'>
  inspect: (() => void) | undefined
  copyLabel: string
  copiedLabel: string
  t: Translate
}) {
  const code = sourceOf(block.call)
  const output = scienceToolResultText(block)
  const title = toolName === 'run_r' ? t('run.titleR') : t('run.titlePython')
  const stateSummary = state === 'error' ? t('run.failed')
    : state === 'stopped' ? t('run.stopped') : ''
  return (
    <ScienceToolCell state={state} icon={<IconCodeOutline16 size={14} />} title={title}
      summary={stateSummary || firstLine(code) || firstLine(output ?? '')}
      code={code === '' ? undefined : { text: code, language: toolName === 'run_r' ? 'r' : 'python' }}
      output={output} inspect={inspect} copyLabel={copyLabel} copiedLabel={copiedLabel} toolKind="science-run" />
  )
}

/** Render one language-labeled `run_python`/`run_r` row across its eight presentation states. */
export function ScienceExecutionRow({ block, callId, toolName, inspect, useProjection, cancel, t }: ScienceExecutionRowProps) {
  const state = scienceToolRowState(block)
  const title = toolName === 'run_r' ? t('run.titleR') : t('run.titlePython')
  const science = useProjection('science')
  const run: ScienceClientRun | undefined = science?.runs.find(candidate => candidate.toolCallId === callId)

  if (state === 'running') {
    return <RunningRow title={title} startedAt={run?.startedAt ?? block.time} cancel={cancel} t={t} />
  }
  if (state !== 'ok') {
    return <FallbackRow block={requireSettled(block)} toolName={toolName} state={state} inspect={inspect}
      copyLabel={t('cell.copy')} copiedLabel={t('cell.copied')} t={t} />
  }

  const resultText = scienceToolResultText(block) ?? ''
  const sections = splitRunResultSections(resultText)
  if (run === undefined || sections === null) {
    return <FallbackRow block={requireSettled(block)} toolName={toolName} state={state} inspect={inspect}
      copyLabel={t('cell.copy')} copiedLabel={t('cell.copied')} t={t} />
  }

  if (run.status === 'success') {
    const durationMs = Math.max(0, run.finishedAt - run.startedAt)
    return <SuccessRow title={title} kernelEpoch={run.kernelEpoch} durationMs={durationMs}
      sections={sections} truncated={run.stdoutTruncated} t={t} />
  }
  const failureCode = 'failureCode' in run ? run.failureCode : undefined
  if (failureCode === 'KERNEL_DIED') {
    return <KernelDiedRow title={title} kernelEpoch={run.kernelEpoch} inspect={inspect} t={t} />
  }
  return <FailedRow title={title} kernelEpoch={run.kernelEpoch} sections={sections} t={t} />
}
