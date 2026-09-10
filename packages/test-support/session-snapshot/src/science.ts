/** Normalization of volatile Science facts and their structured get_science_state projection. */
type ObjectValue = Record<string, unknown>

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Normalize only Science-owned clocks, interpreter observations and opaque scratch identities.
 * Facts are collected from Science events; equal observations retain equal tokens across event and tool views.
 * User text, source, artifact hashes, versions and byte counts remain unchanged.
 * @param rawLog - One persisted or already normalized Session JSONL.
 * @returns JSONL with Science volatility replaced, or the unchanged input when no Science facts exist.
 */
export function normalizeScienceSnapshot(rawLog: string): string {
  const lines = rawLog.split('\n')
  const rows = lines.filter(line => line.trim() !== '').map(line => JSON.parse(line) as ObjectValue)
  if (!rows.some(row => typeof row.type === 'string' && row.type.startsWith('science/'))) return rawLog
  const values = new Map<string, string>()
  const ordinals = new Map<string, number>()
  const claim = (value: unknown, kind: string): void => {
    if (typeof value !== 'string' || values.has(value)) return
    const token = /^\{\{science-([a-z]+):([1-9]\d*)\}\}$/.exec(value)
    if (token) {
      const kindToken = token[1] as string
      ordinals.set(kindToken, Math.max(ordinals.get(kindToken) ?? 0, Number(token[2])))
      values.set(value, value)
      return
    }
    const ordinal = (ordinals.get(kind) ?? 0) + 1
    ordinals.set(kind, ordinal)
    values.set(value, `{{science-${kind}:${ordinal}}}`)
  }
  for (const row of rows) {
    if (!object(row.data)) continue
    if (row.type === 'science/environment-bound' && object(row.data.environment)) {
      for (const language of ['python', 'r']) {
        const binding = row.data.environment[language]
        if (!object(binding)) continue
        claim(binding.configuredPrefix, 'prefix')
        claim(binding.canonicalPrefix, 'prefix')
        claim(binding.executableIdentity, 'executable')
        claim(binding.bindingFingerprint, 'binding')
      }
    }
    if ((row.type === 'science/run-started' || row.type === 'science/run-finished') && object(row.data.run)) {
      claim(row.data.run.environmentFingerprint, 'binding')
      claim(row.data.run.scratchKey, 'scratch')
    }
    if (row.type === 'science/kernel-state' && object(row.data.kernel)) claim(row.data.kernel.environmentFingerprint, 'binding')
  }
  const fields = new Set(['configuredPrefix', 'canonicalPrefix', 'executable', 'executableIdentity',
    'bindingFingerprint', 'environmentFingerprint', 'scratchKey', 'fingerprint'])
  const replace = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') {
      if (key === undefined || !fields.has(key)) return value
      const exact = values.get(value)
      if (exact !== undefined) return exact
      for (const [source, token] of values) {
        if (token.startsWith('{{science-prefix:') && value.startsWith(source + '/')) return token + value.slice(source.length)
        if (token.startsWith('{{science-binding:') && source.length === 64 && value === source.slice(0, 12)) return token
      }
      return value
    }
    if (Array.isArray(value)) return value.map(item => replace(item))
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item, key)]))
    return value
  }
  const clocks = (value: unknown, keys: readonly string[]): void => {
    if (!object(value)) return
    for (const key of keys) {
      if (typeof value[key] === 'number') value[key] = 0
    }
  }
  const calls = new Map(rows.flatMap(row => row.type === 'tool/call' && object(row.data)
    ? [[row.data.callId, row.data.name] as const] : []))
  for (const row of rows) {
    if (!object(row.data)) continue
    let data = row.data
    if (['science/environment-bound', 'science/run-started', 'science/run-finished',
      'science/kernel-state', 'science/artifact-saved'].includes(String(row.type))) {
      data = replace(data) as ObjectValue
      row.data = data
      switch (row.type) {
        case 'science/environment-bound': clocks(data.environment, ['configuredAt', 'validatedAt']); break
        case 'science/run-started':
        case 'science/run-finished': clocks(data.run, ['startedAt', 'finishedAt']); break
        case 'science/kernel-state': clocks(data.kernel, ['at']); break
        case 'science/artifact-saved': clocks(data.artifact, ['seenAt']); break
      }
    }
    if (row.type === 'user/message' && object(data.source)
      && data.source.kind === 'plugin' && data.source.plugin === '@deepseek-ai/dsh-system-prompt'
      && Array.isArray(data.source.sections)) {
      for (const section of data.source.sections) {
        if (!object(section) || section.name !== 'science:environment' || typeof section.text !== 'string') continue
        const previous = section.text
        const normalized = previous.replace(/fingerprint ([a-f0-9]{12})\./g,
          (_match, digest: string) => `fingerprint ${String(replace(digest, 'fingerprint'))}.`)
        section.text = normalized
        if (Array.isArray(data.content)) for (const block of data.content) {
          if (object(block) && block.type === 'text' && typeof block.text === 'string') {
            block.text = block.text.split(previous).join(normalized)
          }
        }
      }
    }
    if (row.type !== 'tool/result' || !object(data.message) || !object(data.message.source)
      || calls.get(data.message.source.callId) !== 'get_science_state') continue
    const blocks = data.message.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (!object(block) || block.type !== 'tool-result' || block.isError === true || !Array.isArray(block.content)) continue
      for (const content of block.content) {
        if (!object(content) || content.type !== 'text' || typeof content.text !== 'string') continue
        const state: unknown = replace(JSON.parse(content.text))
        if (!object(state)) throw new Error('get_science_state snapshot result must be an object')
        clocks(state.environment, ['configuredAt', 'validatedAt'])
        for (const [key, names] of [
          ['runs', ['startedAt', 'finishedAt']], ['kernels', ['startedAt', 'endedAt']], ['artifacts', ['seenAt']],
        ] as const) {
          const entries = state[key]
          if (Array.isArray(entries)) for (const entry of entries) clocks(entry, names)
        }
        content.text = JSON.stringify(state, null, 2)
      }
    }
  }
  let index = 0
  return lines.map(line => line.trim() === '' ? line : JSON.stringify(rows[index++])).join('\n')
}
