/** On-demand inspection of logged calls without changing the active trajectory view. */

import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScienceTraceStep, ScienceTraceStepMember, ScienceTraceStepTitle } from './science-trace-model.ts'
import { capTextForDisplay, MAX_ARTIFACT_TEXT_CHARACTERS, type RenderTruncation } from './format.ts'
import { firstLine, splitRunResultSections } from './run-output.ts'
import css from './ScienceTraceView.module.css'

function argumentsOf(member: ScienceTraceStepMember): { code?: { text: string; language: string }; input: string } {
  let args: unknown
  try { args = JSON.parse(member.argsRaw) }
  catch {
    // Incomplete or invalid logged tool JSON remains inspectable as supplied.
    return { input: member.argsRaw }
  }
  if (member.title.kind === 'run' && typeof args === 'object' && args !== null && 'code' in args && typeof args.code === 'string') {
    const { code, ...input } = args
    return { code: { text: code, language: member.title.language }, input: JSON.stringify(input, null, 2) }
  }
  return { input: JSON.stringify(args, null, 2) }
}

/**
 * Show a literal source preview, never an inferred description of what the code does.
 * @param member - Logged call whose source may be available.
 * @returns First nonblank code line, or no preview for other calls.
 */
export function scienceTraceCodePreview(member: ScienceTraceStepMember): string | undefined {
  const code = argumentsOf(member).code
  return code === undefined ? undefined : firstLine(code.text).slice(0, 180)
}

function TruncationNotice({ capped, t }: { capped: RenderTruncation<string>; t: TranslateNS<'science'> }) {
  return capped.truncated && <p>{t('artifact.textTruncated', { shown: capped.value.length, total: capped.total })}</p>
}

function LoggedCode({ code, t }: { code: { text: string; language: string }; t: TranslateNS<'science'> }) {
  const capped = capTextForDisplay(code.text, MAX_ARTIFACT_TEXT_CHARACTERS)
  return <section aria-label={t('trace.detail.code')}>
    <b>{t('trace.detail.code')}</b>
    <CodeBlock code={capped.value} lang={code.language} copyLabel={t(capped.truncated ? 'trace.detail.copyExcerpt' : 'cell.copy')} copiedLabel={t('cell.copied')} />
    <TruncationNotice capped={capped} t={t} />
  </section>
}

function LoggedText({ label, text, t }: { label: string; text: string; t: TranslateNS<'science'> }) {
  const capped = capTextForDisplay(text, MAX_ARTIFACT_TEXT_CHARACTERS)
  return <section className={css.loggedText} aria-label={label}>
    <b>{label}</b>
    <pre tabIndex={0}>{capped.value || t('trace.detail.empty')}</pre>
    <TruncationNotice capped={capped} t={t} />
  </section>
}

function CallDetails({ member, label, t }: { member: ScienceTraceStepMember; label: string; t: TranslateNS<'science'> }) {
  const args = argumentsOf(member)
  const text = member.result?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
  const nonText = member.result?.content.filter(block => block.type !== 'text') ?? []
  const sections = member.title.kind === 'run' ? splitRunResultSections(text) : null
  const run = member.run
  return <section className={css.callDetails} aria-label={label} data-call-id={member.callId}>
    <h4>{label}</h4>
    {run !== undefined && <p className={css.facts}>
      {t('run.kernel', { epoch: run.kernelEpoch })} · {t('trace.detail.environment', { revision: run.environmentRevision })}
      {'failureCode' in run && <> · {run.failureCode}</>}
    </p>}
    {args.code !== undefined && <LoggedCode code={args.code} t={t} />}
    {(args.code === undefined || args.input !== '{}') && <LoggedText label={t('trace.detail.input')} text={args.input} t={t} />}
    {member.result === undefined ? <p role="status">{t('trace.detail.pending')}</p> : <>
      {sections === null
        ? <LoggedText label={t('trace.detail.output')} text={text} t={t} />
        : <>
          <LoggedText label={t('trace.detail.stdout')} text={sections.stdout} t={t} />
          <LoggedText label={t('trace.detail.stderr')} text={sections.stderr} t={t} />
          <details>
            <summary>{t('trace.detail.rawResult')}</summary>
            <LoggedText label={t('trace.detail.output')} text={text} t={t} />
          </details>
        </>}
      {nonText.length > 0 && <p>{t('trace.detail.nonText', { types: nonText.map(block => block.type).join(', '), count: nonText.length })}</p>}
    </>}
    {run !== undefined && 'stdoutBytes' in run && <p className={css.facts}>
      {t('trace.detail.bytes', { stdout: run.stdoutBytes, stderr: run.stderrBytes })}
      {(run.stdoutTruncated || run.stderrTruncated) && <> · {t('trace.detail.truncated')}</>}
    </p>}
  </section>
}

/**
 * Render every call in a step, including each member of a grouped browse row.
 * @param props - Logged step and localized labels.
 * @returns Local input/output inspection, with no cross-view navigation callbacks.
 */
export function ScienceTraceStepDetails({ step, titleOf, t }: {
  step: ScienceTraceStep
  titleOf: (title: ScienceTraceStepTitle, t: TranslateNS<'science'>) => string
  t: TranslateNS<'science'>
}) {
  return <div className={css.stepDetails}>
    {step.members.map(member => <CallDetails key={member.callId} member={member} label={titleOf(member.title, t)} t={t} />)}
  </div>
}
