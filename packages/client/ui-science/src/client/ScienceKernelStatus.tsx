import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ScienceClientKernel } from '@deepseek-ai/dsh-science-session/types'
import css from './ScienceKernelStatus.module.css'

/** Full props for the fixed Science kernel readout. */
export type ScienceKernelStatusProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<'science'>

/** Show the last recorded lifecycle state; durable history does not establish process liveness. */
export function ScienceKernelStatus({ useProjection, t }: ScienceKernelStatusProps) {
  const science = useProjection('science')
  if (science === undefined || science === null || science.kernels.length === 0) return null
  const latest = new Map<ScienceClientKernel['language'], ScienceClientKernel>()
  for (const kernel of science.kernels) latest.set(kernel.language, kernel)
  return (
    <div className={css.root} aria-label={t('kernel.status')}>
      <span>{t('kernel.status')}</span>
      {[...latest.values()].map(kernel => (
        <span className={css.kernel} key={kernel.language}>
          <span className={css.dot} aria-hidden="true" />
          {t('kernel.item', { language: kernel.language, epoch: kernel.kernelEpoch, state: t(`kernel.${kernel.state}`) })}
        </span>
      ))}
    </div>
  )
}
