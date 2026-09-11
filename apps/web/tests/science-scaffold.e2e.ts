/** Browser-fixture navigation across asynchronous workspace expansion. */
import { expect, it } from 'vitest'
import { chromium } from 'playwright'
import { openScienceSeed } from './science-scaffold.ts'

it.each([false, true])('opens an expanding seeded workspace with a provisional group: %s', async (provisional) => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(2000)
    await page.setContent(`
      ${provisional ? '<div role="treeitem" aria-expanded="false">Ungrouped</div>' : ''}
      <div id="workspace" role="treeitem" aria-expanded="false">
        workspace <button aria-label="Workspace actions for workspace">Actions</button>
      </div>
      <div id="session" role="treeitem" aria-selected="false" hidden>Seeded experiment</div>
      <button role="tab" hidden>Chat</button>
      <p hidden>Inspect the seeded experiment.</p>
      <script>
        const group = document.querySelector('#workspace');
        const session = document.querySelector('#session');
        function expand(value) {
          group.setAttribute('aria-expanded', String(value));
          session.hidden = !value;
        }
        group.addEventListener('pointerenter', () => expand(true));
        group.addEventListener('click', () => expand(group.getAttribute('aria-expanded') !== 'true'));
        session.addEventListener('click', () => {
          document.querySelector('[role="tab"]').hidden = false;
        });
        document.querySelector('[role="tab"]').addEventListener('click', () => {
          document.querySelector('p').hidden = false;
        });
      </script>
    `)
    await openScienceSeed(page, 'Inspect the seeded experiment.')
    expect(await page.getByText('Inspect the seeded experiment.', { exact: true }).isVisible()).toBe(true)
    expect(await page.locator('#workspace').getAttribute('aria-expanded')).toBe('true')
  } finally {
    await browser.close()
  }
})
