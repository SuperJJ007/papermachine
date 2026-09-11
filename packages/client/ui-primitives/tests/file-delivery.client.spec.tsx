// @vitest-environment jsdom
/** File output disclosure and menu actions preserve independently addressable controls. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FileDeliveryCard } from '../src/FileDeliveryCard.tsx'
import { FileDeliveryGroup } from '../src/FileDeliveryGroup.tsx'

afterEach(cleanup)

it.each([0, 1, 4, 5, 7])('discloses all %i identities without merging their titles', (count) => {
  const items = Array.from({ length: count }, (_, index) => ({ id: String(index), content: <span>same name</span> }))
  const view = render(<FileDeliveryGroup items={items} collapsedCount={4}
    expandLabel="More" collapseLabel="Less" expandAriaLabel="Show all files" collapseAriaLabel="Collapse files" />)
  expect(view.queryAllByRole('listitem')).toHaveLength(Math.min(count, 4))
  if (count <= 4) {
    expect(view.queryByRole('button')).toBeNull()
    return
  }
  const button = view.getByRole('button', { name: 'Show all files' })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(document.getElementById(button.getAttribute('aria-controls')!)).toBe(view.getByRole('list'))
  fireEvent.click(button)
  expect(view.getAllByRole('listitem')).toHaveLength(count)
  fireEvent.click(view.getByRole('button', { name: 'Collapse files' }))
  expect(view.getAllByRole('listitem')).toHaveLength(4)
})

it('restores action focus after menu selection and withdraws a disabled menu', () => {
  const onPreview = vi.fn()
  const onSelect = vi.fn()
  const props = { title: '长中文 文件名.csv', subtitle: 'v2', thumbnail: <span>icon</span>,
    previewLabel: 'Card preview', actionAriaLabel: 'Preview exact version', actionLabel: 'Preview', onPreview,
    menu: { label: 'More actions', disabled: false, items: [{ id: 'save', label: 'Save' }], onSelect } }
  const view = render(<FileDeliveryCard {...props} />)
  fireEvent.click(view.getByRole('button', { name: 'Card preview' }))
  fireEvent.click(view.getByRole('button', { name: 'Preview exact version' }))
  expect(onPreview).toHaveBeenCalledTimes(2)
  fireEvent.click(view.getByRole('button', { name: 'More actions' }))
  const save = view.getByRole('menuitem', { name: 'Save' })
  expect(document.activeElement).toBe(save)
  fireEvent.click(save)
  expect(onSelect).toHaveBeenCalledWith('save')
  expect(document.activeElement).toBe(view.getByRole('button', { name: 'Preview exact version' }))
  fireEvent.click(view.getByRole('button', { name: 'More actions' }))
  view.rerender(<FileDeliveryCard {...props} menu={{ ...props.menu, disabled: true }} />)
  expect(view.queryByRole('menu')).toBeNull()
  expect(view.getByRole('button', { name: 'More actions' }).hasAttribute('disabled')).toBe(true)
})
