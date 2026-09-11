/** File preview actions with optional secondary actions and caller-owned content. */
import { useRef, useState, type ReactNode } from 'react'
import { Menu, type MenuItem } from './Menu.tsx'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import css from './FileDelivery.module.css'

/** Localized file identity and callbacks; loading and authorization belong to the caller. */
export interface FileDeliveryCardProps {
  title: string
  subtitle: string
  thumbnail: ReactNode
  titleTooltip?: string | undefined
  previewLabel: string
  actionLabel: string
  actionAriaLabel: string
  previewHint?: string | undefined
  onPreview: () => void
  status?: boolean | undefined
  error?: boolean | undefined
  menu?: { label: string; disabled: boolean; items: readonly MenuItem[]; onSelect: (id: string) => void } | undefined
}

/**
 * Render separate preview and menu buttons with shared layout and focus behavior.
 * @param props - Display content, localized labels and authorized action callbacks.
 * @returns A file card with an optional anchored menu.
 */
export function FileDeliveryCard({ title, subtitle, thumbnail, titleTooltip, previewLabel, actionLabel,
  actionAriaLabel, previewHint, onPreview, status, error, menu }: FileDeliveryCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const actionRef = useRef<HTMLButtonElement>(null)
  const menuDisabled = menu === undefined || menu.disabled
  if (menuDisabled && menuOpen) setMenuOpen(false)
  return <div className={css.file}>
    <button type="button" className={css.cardPreview} title={titleTooltip} aria-label={previewLabel} onClick={onPreview} />
    <span className={css.fileIcon}>{thumbnail}</span>
    <div className={css.fileBody}>
      <div className={css.details}>
        <span className={css.fileName}>{title}</span>
        <span className={css.description} role={status ? 'status' : undefined} data-error={error || undefined}
          data-preview-hint={previewHint === undefined ? undefined : true}>
          <span className={css.secondaryText}>{subtitle}</span>
          {previewHint !== undefined && <span className={css.previewHint}>{previewHint}</span>}
        </span>
      </div>
      <div className={css.split}>
        <button ref={actionRef} type="button" className={css.open} aria-label={actionAriaLabel} onClick={onPreview}>{actionLabel}</button>
        {menu !== undefined && <Menu className={css.menuAnchor} open={menuOpen && !menuDisabled} autoFocus portal align="end"
          onClose={() => { setMenuOpen(false) }}
          anchor={<button type="button" className={css.chevron} disabled={menuDisabled} aria-haspopup="menu"
            aria-expanded={menuOpen && !menuDisabled} aria-label={menu.label} onClick={() => { setMenuOpen(value => !value) }}>
            <IconChevronDownOutline14 size={11} />
          </button>}
          items={menu.items} onSelect={(id) => { setMenuOpen(false); actionRef.current?.focus(); menu.onSelect(id) }} />}
      </div>
    </div>
  </div>
}
