/** Source checks for the produced-files and explicit-delivery layout. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')

describe('deliverables layout', () => {
  it('keeps the first file-section offset and removes the second', () => {
    expect(read('ProducedFiles.module.css')).toMatch(/\.root\s*\{[^}]*margin-top:\s*4px/s)
    const deliveries = read('Deliverables.module.css')
    expect(deliveries).toMatch(/\.root\s*\{[^}]*margin-top:\s*4px/s)
    expect(deliveries).toMatch(/\.root\[data-after-produced-files='true'\]\s*\{\s*margin-top:\s*0;\s*\}/)
  })
})
