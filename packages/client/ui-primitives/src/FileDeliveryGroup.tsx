/** A caller-sized collection of file cards with reversible disclosure. */
import { useId, useState, type ReactNode } from 'react'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from './icons/index.tsx'
import css from './FileDelivery.module.css'

/** The owner supplies stable item identities, the display limit, and localized disclosure labels. */
export interface FileDeliveryGroupProps {
  items: readonly { id: string; content: ReactNode }[]
  collapsedCount: number
  heading?: string | undefined
  expandLabel: string
  collapseLabel: string
  expandAriaLabel: string
  collapseAriaLabel: string
}

/**
 * Show the first configured items until the user expands the group.
 * @param props - Ordered cards, deployment limit and localized labels.
 * @returns The card list and disclosure, or null for an empty collection.
 */
export function FileDeliveryGroup({ items, collapsedCount, heading, expandLabel, collapseLabel,
  expandAriaLabel, collapseAriaLabel }: FileDeliveryGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  if (items.length === 0) return null
  const collapsible = items.length > collapsedCount
  const visible = expanded ? items : items.slice(0, collapsedCount)
  return <section className={css.root}>
    {heading !== undefined && <p className={css.heading}>{heading}</p>}
    <div id={id} className={css.presented} role="list" data-single={items.length === 1 || undefined}>
      {visible.map(item => <div key={item.id} role="listitem">{item.content}</div>)}
    </div>
    {collapsible && <button type="button" className={css.toggle} aria-expanded={expanded} aria-controls={id}
      aria-label={expanded ? collapseAriaLabel : expandAriaLabel} onClick={() => { setExpanded(value => !value) }}>
      <span>{expanded ? collapseLabel : expandLabel}</span>
      {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
    </button>}
  </section>
}
