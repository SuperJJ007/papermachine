// @vitest-environment jsdom
/** Message-side run code, execution log, and environment facts. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ScienceClientRun } from '@deepseek-ai/dsh-science-session/types'
import { ScienceRunDetails } from '../src/client/ScienceRunDetails.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
afterEach(cleanup)

/** Wrap one `ToolCallBlock`-shaped fixture as the `ChatNode<'tool-call'>` `resolveRunCall` reads. */
function snapshotWith(block: unknown): ConversationSnapshot {
  const node = block === undefined ? undefined : { kind: 'tool-call', data: { root: block } }
  const nodes = new Map(node === undefined ? [] : [[conversationContextKey('tool-call', 'call-1'), node]])
  return { chat: { nodes } } as unknown as ConversationSnapshot
}

function runFixture(over: Partial<ScienceClientRun> = {}): ScienceClientRun {
  return {
    runId: 'run-1', language: 'python', toolCallId: 'call-1', requestHeaderSeq: 1,
    environmentRevision: 3, environmentFingerprintPreview: 'fp-preview12',
    startedAt: 1_000, codeSha256: 'abc123', kernelEpoch: 1,
    status: 'success', finishedAt: 2_000, stdoutBytes: 10, stderrBytes: 0,
    stdoutTruncated: false, stderrTruncated: false,
    ...over,
  } as unknown as ScienceClientRun
}

describe('ScienceRunDetails', () => {
  it('renders captured code, execution output, and environment facts for a settled run', () => {
    const block = { kind: 'tool-result', call: { name: 'run_python', argsRaw: JSON.stringify({ code: 'x = 1' }) },
      content: [{ type: 'text', text: 'x is 1' }, { type: 'image', source: 'ignored' }] }
    render(<ScienceRunDetails run={runFixture()} snapshot={snapshotWith(block)} t={t} />)
    expect(screen.getByText('x = 1')).toBeTruthy()
    // A non-text content item stringifies rather than being dropped, so both
    // the text line and the stringified fallback land in the same log block.
    expect(screen.getByText(/x is 1/)).toBeTruthy()
    expect(screen.getByText(/"type": "image"/)).toBeTruthy()
    expect(screen.getByText('Environment revision 3 · fingerprint fp-preview12')).toBeTruthy()
  })

  it('treats a resolvable call with no backfilled call head as unavailable code', () => {
    const block = { kind: 'tool-result', call: null, content: ['irrelevant'] }
    render(<ScienceRunDetails run={runFixture()} snapshot={snapshotWith(block)} t={t} />)
    expect(screen.getByText(
      'The code is outside the loaded conversation history. Load more history to see it.',
    )).toBeTruthy()
  })

  it('shows pending placeholders for code and the log when the call is outside the loaded window', () => {
    render(<ScienceRunDetails run={runFixture()} snapshot={snapshotWith(undefined)} t={t} />)
    expect(screen.getAllByText(
      'The code is outside the loaded conversation history. Load more history to see it.',
    )).toHaveLength(1)
    expect(screen.getByText(
      'The execution log is outside the loaded conversation history. Load more history to see it.',
    )).toBeTruthy()
  })

  it('treats a captured call whose args do not carry a code string as unavailable code', () => {
    const block = { kind: 'tool-result', call: { name: 'run_python', argsRaw: JSON.stringify({ notCode: 1 }) }, content: [] }
    render(<ScienceRunDetails run={runFixture()} snapshot={snapshotWith(block)} t={t} />)
    expect(screen.getByText(
      'The code is outside the loaded conversation history. Load more history to see it.',
    )).toBeTruthy()
  })

  it('treats malformed captured args as unavailable code, reading a still-running call\'s own argsRaw field', () => {
    const runningCall = { callId: 'call-1', name: 'run_python', argsRaw: 'not json', turn: 1, step: 1, time: 1, callView: null, subCalls: [] }
    render(<ScienceRunDetails run={runFixture({ status: 'running' })} snapshot={snapshotWith(runningCall)} t={t} />)
    expect(screen.getByText(
      'The code is outside the loaded conversation history. Load more history to see it.',
    )).toBeTruthy()
  })

  it('shows the running placeholder for the log while the run is still in progress, regardless of a resolvable call', () => {
    const block = { kind: 'tool-result', call: { name: 'run_python', argsRaw: JSON.stringify({ code: 'x = 1' }) }, content: [] }
    render(<ScienceRunDetails run={runFixture({ status: 'running' })} snapshot={snapshotWith(block)} t={t} />)
    expect(screen.getByText('The run is still in progress.')).toBeTruthy()
  })
})
