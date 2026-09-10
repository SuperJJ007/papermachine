/** Science normalization preserves semantic facts and cross-view identity distinctions. */
import { describe, expect, it } from 'vitest'
import { normalizeScienceSnapshot } from '../src/science.ts'

const fingerprint = 'a'.repeat(64)
const scratch = 'b'.repeat(64)
function fixture(prefix = '/private/science', hash = fingerprint): string {
  return [
    { type: 'session', id: 'session' },
    { type: 'science/environment-bound', data: { version: 1, environment: {
      configuredAt: 42, validatedAt: 43, revision: 1, python: {
        configuredPrefix: prefix, canonicalPrefix: prefix, executable: prefix + '/bin/python',
        executableIdentity: 'stat-' + prefix, bindingFingerprint: hash, languageVersion: 'Python 3.13',
      },
    } } },
    { type: 'science/run-started', data: { run: {
      startedAt: 44, environmentFingerprint: hash, scratchKey: scratch, codeSha256: fingerprint,
    } } },
    { type: 'science/run-finished', data: { run: {
      startedAt: 44, finishedAt: 45, environmentFingerprint: hash, scratchKey: scratch, status: 'success', stdoutBytes: 24,
    } } },
    { type: 'science/kernel-state', data: { kernel: { at: 44, environmentFingerprint: hash, state: 'started' } } },
    { type: 'science/artifact-saved', data: { artifact: { seenAt: 46, version: 2, sha256: fingerprint, title: fingerprint } } },
    { type: 'tool/call', data: { name: 'get_science_state', callId: 'state' } },
    { type: 'tool/result', data: { message: { source: { callId: 'state' }, content: [{
      type: 'tool-result', content: [{ type: 'text', text: JSON.stringify({
        environment: { validatedAt: 43, python: { fingerprint: hash.slice(0, 12) } },
        runs: [{ startedAt: 44, finishedAt: 45, scratchKey: scratch }], kernels: [{ startedAt: 44 }],
        artifacts: [{ seenAt: 46, caption: hash }], metrics: { runCount: 1 },
      }) }],
    }] } } },
    { type: 'user/message', data: { content: [{ type: 'text', text: `${prefix} ${hash} 42` }] } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
}

describe('Science Session snapshot normalization', () => {
  it('normalizes known observations and clocks while preserving hashes, versions, stdout and user text', () => {
    const result = normalizeScienceSnapshot(fixture())
    expect(result).toContain('{{science-prefix:1}}/bin/python')
    expect(result).toContain('{{science-binding:1}}')
    expect(result).toContain('{{science-scratch:1}}')
    expect(result).not.toContain('"startedAt":44')
    expect(result).toContain('"codeSha256":"' + fingerprint + '"')
    expect(result).toContain('"sha256":"' + fingerprint + '"')
    expect(result).toContain('"stdoutBytes":24')
    expect(result).toContain('"version":2')
    expect(result).toContain('"title":"' + fingerprint + '"')
    expect(result).toContain(`/private/science ${fingerprint} 42`)
    expect(normalizeScienceSnapshot(result)).toBe(result)
  })

  it('retains mismatched environment references and changed semantic output', () => {
    const baseline = fixture()
    const mismatch = baseline.replace('"environmentFingerprint":"' + fingerprint, '"environmentFingerprint":"' + 'c'.repeat(64))
    expect(normalizeScienceSnapshot(mismatch)).toContain('{{science-binding:2}}')
    expect(normalizeScienceSnapshot(mismatch)).not.toBe(normalizeScienceSnapshot(baseline))
    for (const [before, after] of [['"status":"success"', '"status":"error"'], ['"stdoutBytes":24', '"stdoutBytes":25']]) {
      expect(normalizeScienceSnapshot(baseline.replace(before!, after!))).not.toBe(normalizeScienceSnapshot(baseline))
    }
  })

  it('leaves unrelated event and tool payloads byte-identical', () => {
    const unrelated = '{"type":"tool/result","data":{"validatedAt":42,"text":"' + fingerprint + '"}}\n'
    expect(normalizeScienceSnapshot(unrelated)).toBe(unrelated)
    const appended = '{"type":"science/custom-note","data":{"fingerprint":"' + fingerprint + '","at":42}}\n'
    expect(normalizeScienceSnapshot(fixture() + appended)).toContain(appended)
  })

  it('rejects malformed structured Science state rather than removing comparison evidence', () => {
    expect(() => normalizeScienceSnapshot(fixture().replace('\\"environment\\":', 'invalid:'))).toThrow()
    expect(() => normalizeScienceSnapshot('{bad json')).toThrow()
  })
})

describe('Science projection normalization scope', () => {
  const append = (row: unknown): string => fixture() + JSON.stringify(row) + '\n'
  const result = (content: unknown, source: unknown = { callId: 'state' }): unknown => ({
    type: 'tool/result', data: { message: { source, content } },
  })

  it('normalizes only the named service section and its exact materialized text', () => {
    const text = `Python: available, fingerprint ${fingerprint.slice(0, 12)}.`
    const section = { name: 'science:environment', text }
    const source = { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', sections: [null, {},
      { name: 'other', text }, { name: 'science:environment', text: 1 }, section] }
    const row = { type: 'user/message', data: { source, content: [null, {}, { type: 'image', text },
      { type: 'text', text: 42 }, { type: 'text', text: `before\n${text}\nafter` }] } }
    const normalized = normalizeScienceSnapshot(append(row))
    expect(normalized).toContain('before\\nPython: available, fingerprint {{science-binding:1}}.\\nafter')
    expect(normalized).toContain('"name":"other","text":"' + text + '"')
    expect(normalizeScienceSnapshot(append({ type: 'user/message', data: { source } })))
      .toContain('fingerprint {{science-binding:1}}.')
    for (const value of [null, {}, { kind: 'user' }, { kind: 'plugin', plugin: 'other' },
      { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', sections: null }]) {
      const untouched = { type: 'user/message', data: { source: value, content: [{ type: 'text', text }] } }
      expect(normalizeScienceSnapshot(append(untouched))).toContain(JSON.stringify(untouched))
    }
  })

  it('preserves failed, unrelated, absent and non-text result blocks', () => {
    for (const row of [result(null), result([null, {}, { type: 'text' },
      { type: 'tool-result', isError: true, content: [{ type: 'text', text: '{invalid' }] },
      { type: 'tool-result', content: null }, { type: 'tool-result', content: [null, {},
        { type: 'image', text: 'not JSON' }, { type: 'text', text: 5 }] }]),
    result([], null), result([], { callId: 'other' }), { type: 'tool/result', data: { message: null } },
    { type: 'science/run-started', data: null }, { type: 'science/run-finished', data: {} },
    { type: 'science/environment-bound', data: {} }, { type: 'science/kernel-state', data: {} },
    { type: 'science/artifact-saved', data: {} }]) {
      expect(normalizeScienceSnapshot(append(row))).toContain(JSON.stringify(row))
    }
    const unobserved = result([{ type: 'tool-result', content: [{ type: 'text',
      text: JSON.stringify({ environment: { configuredAt: 'unobserved-clock', python: { fingerprint: 'unobserved' } } }) }] }])
    expect(normalizeScienceSnapshot(append(unobserved))).toContain('unobserved-clock')
    const empty = result([{ type: 'tool-result', content: [{ type: 'text', text: '{}' }] }])
    expect(normalizeScienceSnapshot(append(empty))).toContain(JSON.stringify(empty))
    const primitive = result([{ type: 'tool-result', content: [{ type: 'text', text: '1' }] }])
    expect(() => normalizeScienceSnapshot(append(primitive))).toThrow('must be an object')
  })

  it('keeps distinct observed prefixes and preserves existing token ordinals', () => {
    const different = fixture().replace('"canonicalPrefix":"/private/science"', '"canonicalPrefix":"/canonical/science"')
    expect(normalizeScienceSnapshot(different)).toContain('{{science-prefix:2}}')
    const canonical = fixture().replaceAll('/private/science', '{{science-prefix:7}}')
    expect(normalizeScienceSnapshot(canonical)).toContain('{{science-prefix:7}}/bin/python')
    expect(normalizeScienceSnapshot(fixture() + '\n')).toMatch(/\n\n$/)
  })
})
