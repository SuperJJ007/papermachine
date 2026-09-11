/** File identity and explicit default-app or file-manager actions for one delivery. */
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import {
  FileDeliveryCard, FileTypeIcon, fileExtension, IconRightUpOutline16,
  IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PresentedAction, PresentedHost } from '../presented.ts'
import type { PresentedOpenPhase } from './present-open.ts'
import { basename, type PresentedPath } from './turn-deliverables.ts'
import type { NS } from './locales.ts'

function cardDescription(description: string | undefined, fallback: string): string {
  const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, '').trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/**
 * Render independent file actions without nesting buttons inside a clickable card.
 * @param props - durable file metadata, Sidebar preview, Host capabilities, gesture status, and localized copy.
 * @returns the file card and its anchored action menu.
 */
export function PresentedFileCard({ file, cwd, phase, host, onPreview, onAction, t }: {
  file: PresentedPath
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHost | null
  onPreview: () => void
  onAction: (action: PresentedAction) => void
} & PropsLocale<typeof NS>) {
  const pending = phase === 'opening' || phase === 'revealing'
  const menuDisabled = pending || host === null || !host.available
  const reveal = host?.fileManager ?? 'directory'
  const name = basename(file.path)
  const metadata = fileExtension(name).toUpperCase() || t('presented.file')
  const status = phase === undefined
    ? cardDescription(file.description, metadata)
    : t(reveal === 'directory' && phase === 'revealed' ? 'presented.directoryOpened'
      : reveal === 'directory' && phase === 'revealing' ? 'presented.directoryOpening'
        : reveal === 'directory' && phase === 'revealError' ? 'presented.directoryError' : `presented.${phase}`)
  return <div data-presented-file><FileDeliveryCard title={name} subtitle={status}
    thumbnail={<FileTypeIcon path={file.path} size={20} />} titleTooltip={resolveWorkspacePath(cwd, file.path)}
    previewLabel={t('presented.previewCard', { name: file.path })} actionLabel={t('presented.action')}
    actionAriaLabel={t('presented.previewButton', { name: file.path })} previewHint={t('presented.preview')}
    onPreview={onPreview} status={phase !== undefined}
    error={phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable'}
    menu={{ label: t('presented.more', { name: file.path }), disabled: menuDisabled,
      items: [
        { id: 'open', icon: <IconRightUpOutline16 size={16} />, label: t('presented.defaultApp') },
        { id: 'reveal', icon: <IconFolderOpenOutline16 />, label: t(`presented.${reveal}`) },
      ], onSelect: (id) => { onAction(id === 'reveal' ? 'reveal' : 'open') },
    }} /></div>
}
