import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeSessionLog,
  normalizeSessionSnapshot,
  normalizeStdout,
  refreshFixtureReplacements,
  scrubRequestHeaders,
  stabilizeRefreshLog,
  tokenizeSessionFixtureCwd,
  type HarvestedLog,
  type NormalizeContext,
} from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import {
  decompressZstdFrame,
  scanZstdFrames,
} from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import { describe, expect, it } from 'vitest'

const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const advancedScenarioDir = join(snapshotsDir, 'advanced-toolchain')
const advancedSessionFixture = join(advancedScenarioDir, 'session.jsonl')
const advancedStreamExpected = join(advancedScenarioDir, 'stream-json.expected.jsonl')
const advancedConfigPath = fileURLToPath(new URL('../advanced.cordis.snapshot.yml', import.meta.url))
const ptyScenarioDir = join(snapshotsDir, 'pty-tools')
const ptySessionFixture = join(ptyScenarioDir, 'session.jsonl')
const ptyStreamExpected = join(ptyScenarioDir, 'stream-json.expected.jsonl')
const ptyConfigPath = fileURLToPath(new URL('../pty.cordis.snapshot.yml', import.meta.url))
const goalScenarioDir = join(snapshotsDir, 'goal-tools')
const goalConfigPath = fileURLToPath(new URL('../goal.cordis.snapshot.yml', import.meta.url))
const retryScenarioDir = join(snapshotsDir, 'provider-retry')
const retryConfigPath = fileURLToPath(new URL('../retry.cordis.snapshot.yml', import.meta.url))
const compactionScenarioDir = join(snapshotsDir, 'compaction-recovery')
const compactionSessionFixture = join(compactionScenarioDir, 'session.jsonl')
const compactionStreamExpected = join(compactionScenarioDir, 'stream-json.expected.jsonl')
const compactionConfigPath = fileURLToPath(new URL('../compaction.cordis.snapshot.yml', import.meta.url))
const credentialsScenarioDir = join(snapshotsDir, 'missing-credential')
const credentialsConfigPath = fileURLToPath(new URL('../credentials.cordis.snapshot.yml', import.meta.url))
// Same keyless composition as the missing-credential scenario: the endpoint is
// never dialed either way, because a supplied-but-unusable key fails credential
// resolution exactly where an absent one does.
const invalidCredentialScenarioDir = join(snapshotsDir, 'invalid-credential')
const scienceToolsScenarioDir = join(snapshotsDir, 'science-tools')
const scienceToolsConfigPath = fileURLToPath(new URL('../science-tools.cordis.snapshot.yml', import.meta.url))
const scienceToolsDriver = fileURLToPath(new URL('./fixtures/science-driver.ts', import.meta.url))
const scienceKernelDriverPath = fileURLToPath(new URL('./fixtures/science-kernel-driver.cjs', import.meta.url))
/** The exact PNG the Science fixture writes: neither artifact may carry its bytes. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const ralphScenarioDir = join(snapshotsDir, 'ralph-loop')
const ralphConfigPath = fileURLToPath(new URL('../ralph.cordis.snapshot.yml', import.meta.url))
const settlementScenarioDir = join(snapshotsDir, 'subagent-settlement')
const settlementConfigPath = fileURLToPath(new URL('../subagent-settlement.cordis.snapshot.yml', import.meta.url))
const teamConfigPath = fileURLToPath(new URL('../team.cordis.snapshot.yml', import.meta.url))
const startupFailureConfigPath = fileURLToPath(new URL('./fixtures/startup-activation-error/cordis.yml', import.meta.url))
const startupFailureExpected = join(snapshotsDir, 'startup-activation-error', 'stderr.expected.txt')
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const dshBinScript = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const reasoningConfigPath = fileURLToPath(new URL('./fixtures/cli.cordis.yml', import.meta.url))
const deepseekDefaultsConfigPath = fileURLToPath(new URL('./fixtures/deepseek-defaults.cordis.yml', import.meta.url))
const headlessOverlayPath = fileURLToPath(new URL('./fixtures/headless-profile.cordis.yml', import.meta.url))
const headlessSessionExpected = join(snapshotsDir, 'headless-profile', 'session.expected.jsonl')
const headlessFailureExpected = join(snapshotsDir, 'headless-profile', 'stderr.expected.txt')
const cliMockLlmPluginPath = fileURLToPath(new URL('./fixtures/cli-mock-llm.ts', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

interface JsonObject {
  [key: string]: unknown
}

interface PersistedLog {
  readonly content: string
  readonly header: JsonObject
}

/**
 * Remove persistence envelopes before committing a refreshed replay fixture.
 * @param rawLog - persisted or already-projected session JSONL.
 * @returns projected session JSONL with its header line unchanged.
 */
function projectSessionFixture(rawLog: string): string {
  let recordIndex = 0
  return rawLog.split(/\r?\n/).map((line) => {
    if (line.trim().length === 0) return line
    const record = JSON.parse(line) as Record<string, unknown>
    if (recordIndex++ === 0) {
      if (record.type !== 'session') throw new Error('session fixture must start with a session header')
      return line
    }
    delete record.seq
    delete record.time
    delete record.seq0
    delete record.time0
    return JSON.stringify(record)
  }).join('\n')
}

interface DeepSeekDefaultsServer {
  readonly url: string
  readonly requests: JsonObject[]
  close(): Promise<void>
}

/** Serve one deterministic DeepSeek-compatible response while retaining its request body. */
async function deepseekDefaultsServer(): Promise<DeepSeekDefaultsServer> {
  const requests: JsonObject[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body) as JsonObject)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      let keepAlives = 3
      const write = (): void => {
        if (keepAlives-- > 0) {
          response.write(': keep-alive\n\n')
          setTimeout(write, 60)
          return
        }
        response.end([
          'data: {"choices":[{"delta":{"content":"DEFAULTS_OK"}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
          'data: [DONE]',
          '',
        ].join('\n\n'))
      }
      setTimeout(write, 60)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('DeepSeek defaults snapshot server has no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise(resolve => server.close(() => { resolve() })),
  }
}

function parseJsonl(content: string): JsonObject[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

function contextFromLogs(contents: readonly string[]): NormalizeContext {
  const headers = contents.map(content => parseJsonl(content)[0])
  return {
    sessionIds: headers.flatMap(header => typeof header?.id === 'string' ? [header.id] : []),
    cwd: typeof headers[0]?.cwd === 'string' ? headers[0].cwd : '\0no-cwd\0',
  }
}

function normalizeHeadlessStream(rawStdout: string, cwd: string): string {
  const records = parseJsonl(rawStdout)
  if (records.length === 0) throw new Error('headless snapshot emitted no stream-json records')
  const final = records.at(-1)
  if (final?.type !== 'result') throw new Error('headless snapshot did not end with a result record')
  if (records.slice(0, -1).some(record => record.type !== 'session_event')) {
    throw new Error('headless snapshot emitted a non-event record before its result')
  }

  const sessionIds = [...new Set(records.flatMap(record => typeof record.sessionId === 'string' ? [record.sessionId] : []))]
  if (sessionIds.length !== 1) throw new Error(`headless snapshot streamed ${sessionIds.length} main session ids`)
  const context: NormalizeContext = { sessionIds, cwd }
  const events = records.slice(0, -1).map((record) => {
    if (record.event === null || typeof record.event !== 'object' || Array.isArray(record.event)) {
      throw new Error('headless snapshot emitted an invalid session event')
    }
    return record.event as JsonObject
  })
  const normalizedEvents = parseJsonl(scrubRequestHeaders(normalizeSessionLog(
    `${events.map(event => JSON.stringify(event)).join('\n')}\n`,
    context,
  )))
  const normalizedRecords = records.map((record, index) => index < normalizedEvents.length
    ? { ...record, event: normalizedEvents[index] }
    : record)
  return normalizeStdout(`${normalizedRecords.map(record => JSON.stringify(record)).join('\n')}\n`, context)
}

/** Zero durable goal timestamps inside both metadata records and rendered XML JSON. */
function normalizeGoalTimestamps(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/("(?:createdAt|updatedAt|clearedAt)":)\d+/g, '$10')
  }
  if (Array.isArray(value)) return value.map(normalizeGoalTimestamps)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      ['createdAt', 'updatedAt', 'clearedAt'].includes(key) && typeof item === 'number'
        ? 0
        : normalizeGoalTimestamps(item),
    ]))
  }
  return value
}

/** Normalize the stream's durable goal timestamps after the shared scrubbers. */
function normalizeGoalStream(rawStdout: string, cwd: string): string {
  return parseJsonl(normalizeHeadlessStream(rawStdout, cwd))
    .map(record => JSON.stringify(normalizeGoalTimestamps(record)))
    .join('\n') + '\n'
}

async function scenarioPrompt(dir: string, label: string): Promise<string> {
  const input = JSON.parse(await readFile(join(dir, 'input.json'), 'utf8')) as {
    steps?: { op?: unknown; text?: unknown }[]
  }
  const prompt = input.steps?.find(step => step.op === 'prompt')?.text
  if (typeof prompt !== 'string') throw new Error(`${label} input has no prompt step`)
  return prompt
}

async function readPersistedLog(file: string): Promise<string> {
  const content = await readFile(file)
  if (!file.endsWith('.zstd')) return content.toString('utf8')
  const scan = scanZstdFrames(content)
  if (scan.tornStart !== undefined) throw new Error(`persisted snapshot log has a torn Zstandard frame: ${file}`)
  const decoded: Buffer[] = []
  for (const frame of scan.frames) {
    decoded.push(await decompressZstdFrame(content.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(decoded).toString('utf8')
}

async function persistedLogs(cwd: string, root: string = join(cwd, '.sessions')): Promise<PersistedLog[]> {
  const files = (await readdir(root, { recursive: true }))
    .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
  return Promise.all(files.map(async (file) => {
    const content = await readPersistedLog(join(root, file))
    return { content, header: parseJsonl(content)[0] ?? {} }
  }))
}

/** Install the keyless product-CLI adapter into the temporary headless profile. */
async function prepareCliMockFixture(cwd: string): Promise<void> {
  const fixtureDir = join(cwd, '.dsh', 'profiles', 'headless', 'snapshot-fixtures')
  await mkdir(fixtureDir, { recursive: true })
  await Promise.all([
    copyFile(cliMockLlmPluginPath, join(fixtureDir, 'cli-mock-llm.ts')),
    writeFile(join(fixtureDir, 'package.json'), '{"type":"module"}\n'),
  ])
}

/**
 * Materialize the static fake Conda prefix the deterministic Science
 * composition binds. `bindEnvironment`'s probes (`--version`/`-m`/`-c`) run
 * for real against this script through the real `dsh-subprocess-local`
 * provider; a persistent-kernel launch (any other invocation shape) ignores
 * its own trailing driver-path argument — always the real production driver,
 * never valid to run under Node — keeping only the response-FIFO path, and
 * execs the fake D2-protocol driver instead, so no real Python interpreter
 * or driver source is required.
 */
async function prepareScienceFixture(root: string): Promise<void> {
  const prefix = join(root, 'fake-conda')
  // A conda-meta package record `fake-micromamba` writes on invocation,
  // modeling a real micromamba install actually adding the requested
  // package. The `-m` package-listing probe below reads this marker so the
  // fixture's own install turn re-observes a genuinely different inventory
  // — required for `installPackages` to append a fresh environment revision
  // rather than the no-op a redundant, unchanged install now reports.
  const numpyMarker = join(prefix, 'conda-meta', 'numpy-1.26.4.json')
  await Promise.all([
    mkdir(join(prefix, 'bin'), { recursive: true }),
    mkdir(join(prefix, 'conda-meta'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(prefix, 'bin', 'python'), `#!/bin/sh
case " $* " in
  *" --version "*) printf 'Python 3.13.5\\n' ;;
  *" -m "*)
    if [ -f ${JSON.stringify(numpyMarker)} ]; then
      printf '[{"name":"pip","version":"24.0"},{"name":"numpy","version":"1.26.4"}]'
    else
      printf '[{"name":"pip","version":"24.0"}]'
    fi
    ;;
  *" -c "*) printf 'dsh-科学-✓' ;;
  *)
    while [ "$#" -gt 1 ]; do shift; done
    exec "${process.execPath}" ${JSON.stringify(scienceKernelDriverPath)} "$1"
    ;;
esac
`, { mode: 0o700 }),
    writeFile(join(prefix, 'conda-meta', 'history'), '==> 2026-08-16 <==\n+python-3.13.5\n'),
    // Always-succeeding stand-in for micromamba: `install_science_packages`
    // reaches this through the real sandbox passthrough runner, so it must
    // be a real executable a real subprocess can spawn, not a fake handle.
    writeFile(join(root, 'fake-micromamba'), `#!/bin/sh
touch ${JSON.stringify(numpyMarker)}
exit 0
`, { mode: 0o700 }),
  ])
}

/** Remove host-file and wall-clock identities while retaining Science behavior. */
function normalizeScienceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeScienceValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (['configuredAt', 'validatedAt', 'startedAt', 'finishedAt', 'createdAt', 'publishedAt', 'seenAt', 'at'].includes(key)
        && typeof item === 'number') return [key, 0]
      if (key === 'executableIdentity' && typeof item === 'string') return [key, '<host-file-id>']
      if (key === 'runId' && typeof item === 'string') return [key, '{{scienceRunId}}']
      if (key === 'scratchKey' && typeof item === 'string') return [key, '<scratch-key>']
      // The binding fingerprint covers the prefix path and host file identity,
      // so both it and its model-facing preview move with the temporary root.
      if (key === 'environmentFingerprintPreview' && typeof item === 'string') return [key, '<preview>']
      return [key, normalizeScienceValue(item)]
    }))
  }
  if (typeof value !== 'string') return value
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '{{scienceRunId}}')
    .replace(/\b[0-9a-f]{64}\b/g, '<sha256>')
    .replace(/fingerprint [0-9a-f]{12}\b/g, 'fingerprint <preview>')
    .replace(/"(environmentFingerprintPreview|fingerprint)": "[0-9a-f]{12}"/g, '"$1": "<preview>"')
    .replace(/"(?:configured|validated|started|finished|created|published|seen)At":\s*\d+/g, match => match.replace(/\d+$/, '0'))
    .replace(/"runId":\s*"[^"]+"/g, '"runId": "{{scienceRunId}}"')
    .replace(/"scratchKey":\s*"[^"]+"/g, '"scratchKey": "<scratch-key>"')
}

/** The exact Science identities one snapshot run minted, in durable event order. */
interface ScienceIds {
  readonly runIds: readonly string[]
  readonly chartIds: readonly string[]
}

function scienceIds(rawStdout: string): ScienceIds {
  const runIds: string[] = []
  const chartIds: string[] = []
  for (const record of parseJsonl(rawStdout)) {
    if (record.type !== 'session_event' || record.event === null || typeof record.event !== 'object') continue
    const event = record.event as JsonObject
    const data = event.data as JsonObject | undefined
    const run = data?.run as JsonObject | undefined
    const artifact = data?.artifact as JsonObject | undefined
    if (event.type === 'science/run-started' && typeof run?.runId === 'string') runIds.push(run.runId)
    if (event.type === 'science/artifact-saved' && typeof artifact?.artifactId === 'string') chartIds.push(artifact.artifactId)
  }
  return { runIds, chartIds }
}

/**
 * Replace the exact minted run and chart identities before the generic UUID
 * rule collapses both into one token; a chart cited as a run would otherwise
 * normalize to the same expected text.
 */
function tokenizeScienceIds(content: string, ids: ScienceIds): string {
  const withRuns = ids.runIds.reduce((text, runId) => text.replaceAll(runId, '{{scienceRunId}}'), content)
  return ids.chartIds.reduce((text, chartId) => text.replaceAll(chartId, '{{scienceChartId}}'), withRuns)
}

function normalizeScienceJson(content: string, ids: ScienceIds): string {
  const value = JSON.parse(tokenizeScienceIds(content, ids)) as unknown
  return `${JSON.stringify(normalizeScienceValue(value), undefined, 2)}\n`
}

function normalizeScienceStream(rawStdout: string, cwd: string, runtimeRoot: string, ids: ScienceIds): string {
  const tokenized = tokenizeScienceIds(rawStdout, ids)
  return parseJsonl(normalizeHeadlessStream(tokenized, cwd).replaceAll(runtimeRoot, '{{scienceRuntimeRoot}}'))
    .map(record => JSON.stringify(normalizeScienceValue(record)))
    .join('\n') + '\n'
}

describe('headless stream-json snapshots', () => {
  it('exposes science guidance, schemas, context, and state through a runnable keyless example', async () => {
    let runCwd = ''
    let rawModelView: string | undefined
    let rawChartPreview: string | undefined
    let rawSourceAgreement: string | undefined
    const runtimeRoot = await mkdtemp(join(process.cwd(), '.science-snapshot-runtime-'))
    try {
      const result = await runLoaderSmoke({
        label: 'science tools headless stream-json snapshot',
        tempDirPrefix: 'headless-snapshot-science-tools-',
        binScript: scienceToolsDriver,
        libBinScript: scienceToolsDriver,
        configPath: scienceToolsConfigPath,
        binArgs: [scienceToolsConfigPath, 'Inspect the current Science state.'],
        tsconfigPath,
        env: {
          DSH_SNAPSHOT: 'replay',
          DSH_SCIENCE_SNAPSHOT_ROOT: runtimeRoot,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        },
        prepare: async (cwd) => {
          runCwd = cwd
          await prepareScienceFixture(runtimeRoot)
        },
        inspect: async (cwd) => {
          rawModelView = await readFile(join(cwd, 'science-model-view.json'), 'utf8').catch(() => undefined)
          rawChartPreview = await readFile(join(cwd, 'science-chart-preview.json'), 'utf8').catch(() => undefined)
          rawSourceAgreement = await readFile(join(cwd, 'science-source-agreement.json'), 'utf8').catch(() => undefined)
        },
      })

      expect(result.stderr).toBe('')
      if (rawModelView === undefined) throw new Error(`science adapter did not capture a model request; stdout:\n${result.stdout}`)
      // Both artifacts normalize against the same minted identities, so the
      // model view and the durable stream name the same run and chart.
      const ids = scienceIds(result.stdout)
      if (rawChartPreview === undefined) throw new Error('science driver did not capture a chart preview')
      const chartPreview = normalizeScienceJson(rawChartPreview, ids)
      const chartPreviewExpected = join(scienceToolsScenarioDir, 'chart-preview.expected.json')
      if (refreshing) await writeFile(chartPreviewExpected, chartPreview)
      expect(chartPreview).toBe(await readFile(chartPreviewExpected, 'utf8'))
      expect(chartPreview).toContain('Preview title')
      expect(chartPreview).toContain('Edited input')
      expect(chartPreview).not.toContain('Discarded draft')
      expect(JSON.parse(chartPreview)).toMatchObject({ liveKernelCount: 4 })

      // T5 six-path acceptance, fourth expected file: the project artifact
      // store's own version records (`(a)` authority rule — see
      // `science-session`'s module doc) for every version this scenario
      // committed, dumped after the driver disposes and reboots its Context
      // and resumes the persisted session — proving the Session log and the
      // store still agree on every version's provenance after a cold
      // restart. The driver itself throws loudly (failing this whole test)
      // if a resumed version's sha256 diverges from its pre-restart value or
      // from the store's own row for that versionId, so this golden pins
      // structure (ordinal sequence, `contentOrigin`, `baseExplicit`,
      // `mediaType`, `byteCount`) rather than re-deriving that check.
      if (rawSourceAgreement === undefined) throw new Error('science driver did not capture the source-agreement dump')
      const sourceAgreement = normalizeScienceJson(rawSourceAgreement, ids)
      const sourceAgreementExpected = join(scienceToolsScenarioDir, 'source-agreement.expected.json')
      if (refreshing) await writeFile(sourceAgreementExpected, sourceAgreement)
      expect(sourceAgreement).toBe(await readFile(sourceAgreementExpected, 'utf8'))
      // `plot.png`'s three committed versions: auto-captured (v1), a
      // viewer-style direct chart edit citing v1 explicitly (v2,
      // `baseExplicit: true`), then a plain second run continuing the same
      // logical name with no baseline (v3, `baseExplicit: false`).
      expect(sourceAgreement).toContain('"logicalName": "plot.png"')
      expect(JSON.parse(sourceAgreement)).toEqual(expect.arrayContaining([
        expect.objectContaining({ logicalName: 'plot.png', ordinal: 1, contentOrigin: 'run-auto', baseExplicit: false }),
        expect.objectContaining({ logicalName: 'plot.png', ordinal: 2, contentOrigin: 'human-edit', baseExplicit: true }),
        expect.objectContaining({ logicalName: 'plot.png', ordinal: 3, contentOrigin: 'run-auto', baseExplicit: false }),
        expect.objectContaining({ logicalName: 'plot-review-copy.png', ordinal: 1, contentOrigin: 'human-edit', baseExplicit: true }),
      ]))

      const modelView = normalizeScienceJson(rawModelView, ids)
      const modelViewExpected = join(scienceToolsScenarioDir, 'model-view.expected.json')
      if (refreshing) await writeFile(modelViewExpected, modelView)
      expect(modelView).toBe(await readFile(modelViewExpected, 'utf8'))
      expect(modelView).not.toContain(runCwd)
      expect(modelView).not.toContain(runtimeRoot)
      expect(modelView).not.toContain('configuredPrefix')
      expect(modelView).not.toContain('canonicalPrefix')
      expect(modelView).not.toContain('"executable"')
      expect(modelView).not.toContain('executableIdentity')
      expect(modelView).not.toContain('condaHistorySha256')
      // The chart receipt and sanitized state carry no attachment handle and
      // no image bytes; the Client reads those from the durable event instead.
      expect(modelView).not.toContain('attachmentId')
      expect(modelView).not.toContain(PNG_BASE64)
      // The direct chart edit reaches a later model turn only as
      // `contentOrigin`/`curated` on the sanitized artifact entry —
      // `scienceArtifactSchemaProperties` (`tool-science`) names these the
      // only two store-owned provenance facts the model face exposes; an
      // operation name, element target, or edited text never appears.
      expect(modelView).toContain('\\"contentOrigin\\": \\"human-edit\\"')
      expect(modelView).toContain('\\"curated\\": true')
      expect(modelView).not.toContain('Directly edited chart')
      expect(modelView).not.toContain('Directly edited subtitle')
      expect(modelView).not.toContain('Edited input')
      const captured = JSON.parse(modelView) as { filesystemTools?: unknown }
      expect(captured.filesystemTools).toEqual(['read'])
      // install_science_packages is registered and described alongside the
      // run tools' own persistence guidance, and its captured configured
      // channels never leak (a Host path/identity fact, matching every
      // other Runtime-owned free-text field this scenario checks above).
      expect(modelView).toContain('install_science_packages')
      expect(modelView).toContain('use install_science_packages to persist a package')
      expect(modelView).not.toContain('conda.anaconda.org')
      expect(modelView).not.toContain('fake-micromamba')

      const stream = normalizeScienceStream(result.stdout, runCwd, runtimeRoot, ids)
      const streamExpected = join(scienceToolsScenarioDir, 'stream-json.expected.jsonl')
      if (refreshing) await writeFile(streamExpected, stream)
      expect(stream).toBe(await readFile(streamExpected, 'utf8'))
      expect(stream).not.toContain(PNG_BASE64)
      // Auto-capture's idempotent commit is project-wide, not session-local
      // (the store's current head for a logical name is the sole authority,
      // never this session's own history — see the Auto-capture section of
      // `science-runtime`'s README): this scenario's three idle warmup
      // sessions each run first and share this driver's project, and the
      // fixture's fake kernel driver writes byte-identical
      // `summary.csv`/`meta.json`/`notes.md` content on every run
      // regardless of the requested code, so those three logical names
      // already carry a v1 store row before the main session's own first
      // run writes the identical bytes again — a byte-identical rerun of an
      // existing logical name commits no new version. Only `plot.png`,
      // which no idle run declares in `raster_artifacts`, is new to the
      // project, so the main run's own receipt captures just that one
      // artifact. What follows: one curated re-save and one direct edit
      // reusing the PNG id, one ordinary edited branch, one single-target
      // edit, two outputs from the multi-target edit, one plain-continuation
      // run reusing the PNG id again (T5 path 3), and one `saveArtifactAs`
      // copy minting a fresh id (T5 path 5) — nine events, six unique ids.
      expect(ids.chartIds).toHaveLength(9)
      expect(new Set(ids.chartIds).size).toBe(6)
      // The project artifact store is now the sole authority for a
      // version's provenance (see `science-session`'s module doc):
      // `science/artifact-saved` itself carries no parent reference any
      // more. A run's own `science/run-started.inputs` is the model-visible
      // substitute for the edit chain a `.parent` field used to name; check
      // the raw (pre-normalization) event, since the plot's own id and
      // every edited branch's id all normalize to the same
      // {{scienceChartId}} placeholder.
      // `plot.png`'s auto-captured v1, its metadata-curation re-save (still
      // v1), and the direct edit's new v2 all share this same artifactId
      // (`chartIds[0]`, `[1]`, and `[3]`) — index 0 names it plainly.
      const chartArtifactId = ids.chartIds[0]
      const runInputsFor = (toolCallId: string): unknown => {
        const started = parseJsonl(result.stdout).find((record) => {
          if (record.type !== 'session_event' || record.event === null || typeof record.event !== 'object') return false
          const event = record.event as JsonObject
          const data = event.data as JsonObject | undefined
          const run = data?.run as JsonObject | undefined
          return event.type === 'science/run-started' && run?.toolCallId === toolCallId
        })
        if (started === undefined) throw new Error(`science snapshot stream carries no run-started event for ${toolCallId}; stdout:\n${result.stdout}`)
        return (((started.event as JsonObject).data as JsonObject).run as JsonObject).inputs
      }
      const findSavedArtifact = (logicalName: string): JsonObject => {
        const saved = parseJsonl(result.stdout).find((record) => {
          if (record.type !== 'session_event' || record.event === null || typeof record.event !== 'object') return false
          const event = record.event as JsonObject
          const data = event.data as JsonObject | undefined
          const artifact = data?.artifact as JsonObject | undefined
          return event.type === 'science/artifact-saved' && artifact?.logicalName === logicalName
        })
        if (saved === undefined) throw new Error(`science snapshot stream carries no ${logicalName} artifact-saved event; stdout:\n${result.stdout}`)
        return ((saved.event as JsonObject).data as JsonObject).artifact as JsonObject
      }
      // `edited.png` is sourced from the plot's own baseline version (v1,
      // captured before curation or the direct edit touched it).
      expect(runInputsFor('science-run-call-2')).toEqual([
        { artifactId: chartArtifactId, version: 1, path: 'source.png' },
      ])
      // The single-target edit's `region-edit.png` is sourced from the
      // directly edited chart (v2, the direct edit's own new version).
      expect(runInputsFor('science-selected-edit-call')).toEqual([
        { artifactId: chartArtifactId, version: 2, path: 'region-source.png' },
      ])
      const selectedArtifact = findSavedArtifact('region-edit.png')
      // The multi-target edit's two outputs come from one run: the first
      // target is the same directly edited chart (v2) again, and the
      // second chains off the first edit's own output, `region-edit.png`
      // (v1) — proving an edit can source from another edit's result, not
      // only from an original run-captured artifact.
      expect(runInputsFor('science-region-edit-call')).toEqual([
        { artifactId: chartArtifactId, version: 2, path: 'region-source-1.png' },
        { artifactId: selectedArtifact.artifactId, version: 1, path: 'region-source-2.png' },
      ])
      expect(result.stdout).toContain('SCIENCE_TOOLS_SNAPSHOT_OK')

      // install_science_packages: two whole-value environment-bound
      // revisions on this session (the initial bind, then the fresh
      // revision the install appended) and a result that tells the model
      // plainly the install is not in effect yet.
      const environmentBoundRevisions = parseJsonl(result.stdout).flatMap((record) => {
        if (record.type !== 'session_event' || record.sessionId !== 'science-tools-snapshot') return []
        if (record.event === null || typeof record.event !== 'object') return []
        const event = record.event as JsonObject
        if (event.type !== 'science/environment-bound') return []
        return [((event.data as JsonObject).environment as JsonObject).revision as number]
      })
      expect(environmentBoundRevisions).toEqual([1, 2])
      expect(result.stdout).toContain('SCIENCE_INSTALL_SNAPSHOT_OK')
      expect(result.stdout).toContain('takes effect on the next run_python/run_r call')
      expect(result.stdout).toContain('lost then')
      // The next run_python call (inside the region-edit flow below) proves
      // the lazy-restart mechanic end to end: it finds the newer applied
      // revision and starts a fresh kernel before executing.
      expect(result.stdout).toContain('kernel restarted (environment re-bind): variables from earlier runs are gone')
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('runs one task through the product headless profile command', async () => {
    const task = 'Prove the product headless profile path with one real tool round trip.'
    const result = await runLoaderSmoke({
      label: 'product headless profile snapshot',
      tempDirPrefix: 'headless-snapshot-profile-',
      binScript: dshBinScript,
      configPath: headlessOverlayPath,
      binArgs: ['--profile', 'headless', '--patch', headlessOverlayPath, task],
      tsconfigPath,
      env: {
        DSH_PERMISSION_MODE: 'danger-full-access',
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: prepareCliMockFixture,
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd, join(cwd, '.dsh', 'sessions'))
        expect(logs).toHaveLength(1)
        const actual = logs[0]
        if (actual === undefined) throw new Error('the headless profile did not persist its session')
        const context = contextFromLogs([actual.content])
        const session = normalizeSessionSnapshot(actual.content, context)
        if (refreshing) await writeFile(headlessSessionExpected, session)
        await expect(session).toMatchFileSnapshot(headlessSessionExpected)
        expect(session).toContain(task)
        expect(session).toContain('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP')
      },
    })

    expect(result.stdout).toBe('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP\n')
    expect(result.stderr).toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('prints a terminal model failure through the product headless profile command', async () => {
    const result = await runLoaderSmoke({
      label: 'product headless profile model failure snapshot',
      tempDirPrefix: 'headless-snapshot-profile-failure-',
      binScript: dshBinScript,
      configPath: headlessOverlayPath,
      binArgs: ['--profile', 'headless', '--patch', headlessOverlayPath, 'Trigger the keyless model failure.'],
      tsconfigPath,
      expectedExitCode: 1,
      env: {
        DSH_CLI_MOCK_FAILURE: '1',
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: prepareCliMockFixture,
    })

    expect(result.stdout).toBe('\n')
    await expect(result.stderr).toMatchFileSnapshot(headlessFailureExpected)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('prints the original Loader activation error through the assembled one-shot app', async () => {
    const result = await runLoaderSmoke({
      label: 'headless startup activation error snapshot',
      tempDirPrefix: 'headless-snapshot-startup-error-',
      binScript,
      libBinScript: binScript,
      configPath: startupFailureConfigPath,
      binArgs: [startupFailureConfigPath, 'unreachable task'],
      tsconfigPath,
      expectedExitCode: 1,
    })
    expect(result.stdout).toBe('')
    await expect(result.stderr).toMatchFileSnapshot(startupFailureExpected)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('retries a transient provider failure through the one-shot app', async () => {
    const prompt = await scenarioPrompt(retryScenarioDir, 'provider-retry')
    const streamExpected = join(retryScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'provider retry headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-provider-retry-',
      binScript,
      libBinScript: binScript,
      configPath: retryConfigPath,
      binArgs: [retryConfigPath, prompt],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT: 'replay',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(1)
        const records = parseJsonl(logs[0]?.content ?? '')
        const retries = records.filter(record => record.type === 'llm/retry')
        expect(retries).toHaveLength(1)
        expect(retries[0]?.data).toMatchObject({
          provider: 'deepseek-official',
          mode: 'normal',
          policyKey: '["normal",1,["RATE_LIMIT"],1,1,0]',
          retry: 1,
          maxRetries: 1,
          delayMs: 1,
          failure: { message: 'snapshot transient failure', code: 'RATE_LIMIT', status: 429 },
        })
      },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('recovers from context overflow through an assembled compaction', async () => {
    const prompt = await scenarioPrompt(compactionScenarioDir, 'compaction-recovery')
    let expectedSession = await readFile(compactionSessionFixture, 'utf8')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'compaction recovery headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-compaction-recovery-',
      binScript,
      libBinScript: binScript,
      configPath: compactionConfigPath,
      binArgs: [compactionConfigPath, prompt],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: compactionSessionFixture,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(1)
        const actual = logs[0]
        if (actual === undefined) throw new Error('compaction snapshot did not persist its session')
        const records = parseJsonl(actual.content)
        const types = records.map(record => record.type)
        expect(types.filter(type => type === 'compaction/start')).toHaveLength(1)
        expect(types.filter(type => type === 'compaction/summary')).toHaveLength(1)
        expect(types.filter(type => type === 'compaction/end')).toHaveLength(1)
        const start = types.indexOf('compaction/start')
        const summary = types.indexOf('compaction/summary')
        const replacement = records.findIndex((record) => {
          if (record.type !== 'user/message') return false
          const surfaceOp = record.surfaceOp as JsonObject | undefined
          return surfaceOp?.op === 'replace'
        })
        const end = types.indexOf('compaction/end')
        expect(start).toBeLessThan(summary)
        expect(summary).toBeLessThan(replacement)
        expect(replacement).toBeLessThan(end)
        const summaryRecord = records[summary]
        const summaryData = summaryRecord?.data as JsonObject | undefined
        expect(summaryData?.shadowedSeqs).toEqual(expect.arrayContaining([expect.any(Number)]))
        const final = [...records].reverse().find(record => record.type === 'assistant/message')
        expect(JSON.stringify(final)).toContain('COMPACTION RECOVERED')

        const actualContext = contextFromLogs([actual.content])
        if (refreshing) {
          const harvested: HarvestedLog = {
            id: String(actual.header.id),
            createdAt: Number(actual.header.createdAt),
            content: actual.content,
          }
          const replacements = refreshFixtureReplacements([harvested], [expectedSession])
          expectedSession = projectSessionFixture(tokenizeSessionFixtureCwd(
            stabilizeRefreshLog(actual.content, expectedSession, replacements, actualContext),
          ))
          await writeFile(compactionSessionFixture, expectedSession)
        }
        const expectedContext = contextFromLogs([expectedSession])
        expect(normalizeSessionSnapshot(actual.content, actualContext))
          .toBe(normalizeSessionSnapshot(expectedSession, expectedContext))
      },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(compactionStreamExpected, normalized)
    expect(normalized).toBe(await readFile(compactionStreamExpected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('logs actionable missing-credential guidance through the one-shot app', async () => {
    const streamExpected = join(credentialsScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'missing-credential headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-missing-credential-',
      binScript,
      libBinScript: binScript,
      configPath: credentialsConfigPath,
      binArgs: [credentialsConfigPath, 'say pong'],
      tsconfigPath,
      env: {
        // First-run posture: no key in the environment, none under ./.dsh.
        DEEPSEEK_API_KEY: '',
        DEEPSEEK_BASE_URL: '',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
    })

    // The failure reaches the caller through the stream, not stderr; the
    // recorded transcript below pins the guidance text itself, which names
    // both places a credential can come from and nothing else.
    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // The durable failure leads with the credential store — the path that
    // keeps the secret out of configuration files — then names the launching
    // environment, and stops there: configuration carries the reference, so
    // there is no literal-key escape hatch left to offer.
    expect(normalized).toContain(
      'store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it),',
    )
    expect(normalized).toContain('or export DEEPSEEK_API_KEY in the launching environment')
    expect(normalized).not.toContain('as a last resort')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('logs actionable invalid-credential guidance through the one-shot app', async () => {
    const streamExpected = join(invalidCredentialScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'invalid-credential headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-invalid-credential-',
      binScript,
      libBinScript: binScript,
      configPath: credentialsConfigPath,
      binArgs: [credentialsConfigPath, 'say pong'],
      tsconfigPath,
      env: {
        // A key that exists but no HTTP header can carry — the paste the
        // credential guard exists for: without it, `fetch` refuses to build
        // the header and the turn ends on a retried ByteString TypeError.
        DEEPSEEK_API_KEY: 'sk-\u{1F600}pasted-from-a-chat-window',
        DEEPSEEK_BASE_URL: '',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // The durable failure names the reference to correct and the writer that
    // usually owns it, and stays true in a composition that mounts no Models
    // page at all.
    expect(normalized).toContain('the API key resolved from DEEPSEEK_API_KEY contains characters')
    expect(normalized).toContain('the web Models page writes it')
    // Neither the key nor its transport-level symptom (the ByteString error)
    // may reach the user: the code point of one character is still the key.
    expect(normalized).not.toContain('pasted-from-a-chat-window')
    expect(normalized).not.toContain('ByteString')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('logs the model default and a dynamic next-step reasoning effort', async () => {
    const result = await runLoaderSmoke({
      label: 'reasoning effort headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-reasoning-effort-',
      binScript,
      libBinScript: binScript,
      configPath: reasoningConfigPath,
      binArgs: [reasoningConfigPath, 'prove dynamic reasoning effort'],
      tsconfigPath,
    })

    expect(result.stderr).toBe('')
    const headers = parseJsonl(result.stdout)
      .map(record => record.event)
      .filter((event): event is JsonObject => (
        event !== null
        && typeof event === 'object'
        && !Array.isArray(event)
        && 'type' in event
        && event.type === 'request/header'
      ))
      .map((event) => {
        const data = event.data as JsonObject
        return (data.header as JsonObject).config
      })
    expect(headers).toMatchInlineSnapshot(`
      [
        {
          "model": "cli-mock",
          "provider": "cli-mock",
          "reasoningEffort": "high",
        },
        {
          "model": "cli-mock",
          "provider": "cli-mock",
          "reasoningEffort": "off",
        },
      ]
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('keeps provider comments alive and sends DeepSeek defaults through the one-shot app', async () => {
    const server = await deepseekDefaultsServer()
    try {
      const result = await runLoaderSmoke({
        label: 'DeepSeek adapter defaults headless stream-json snapshot',
        tempDirPrefix: 'headless-snapshot-deepseek-defaults-',
        binScript,
        libBinScript: binScript,
        configPath: deepseekDefaultsConfigPath,
        binArgs: [
          deepseekDefaultsConfigPath,
          'return the deterministic response',
        ],
        tsconfigPath,
        env: {
          // Configuration carries only the reference; the key rides the
          // launching environment, which is the whole credential plane here.
          DEEPSEEK_API_KEY: 'snapshot-key',
          DSH_SNAPSHOT_BASE_URL: server.url,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        },
      })

      expect(result.stderr).toBe('')
      expect(server.requests).toHaveLength(1)
      expect(server.requests[0]?.max_tokens).toBe(256_000)
      expect(server.requests[0]?.reasoning_effort).toBe('low')
      const header = (parseJsonl(result.stdout)
        .map(record => record.event)
        .find((event): event is JsonObject => (
          event !== null
          && typeof event === 'object'
          && !Array.isArray(event)
          && 'type' in event
          && event.type === 'request/header'
        ))?.data as JsonObject | undefined)?.header as JsonObject | undefined
      expect(header?.config).toMatchInlineSnapshot(`
        {
          "maxTokens": 256000,
          "model": "deepseek-v4-flash",
          "provider": "deepseek-official",
          "reasoningEffort": "low",
        }
      `)
      expect(header?.adapterDefaults).toEqual({
        maxTokens: true,
        reasoningEffort: true,
      })
    } finally {
      await server.close()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('replays the advanced toolchain through the one-shot app', async () => {
    const prompt = await scenarioPrompt(advancedScenarioDir, 'advanced-toolchain')
    const fixtureFiles = [
      advancedSessionFixture,
      join(advancedScenarioDir, 'session.1.jsonl'),
      join(advancedScenarioDir, 'session.2.jsonl'),
    ]
    let expectedSessions = await Promise.all(fixtureFiles.map(file => readFile(file, 'utf8')))
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'advanced headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-advanced-',
      binScript,
      libBinScript: binScript,
      configPath: advancedConfigPath,
      binArgs: [advancedConfigPath, prompt],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: advancedSessionFixture,
        DSH_SNAPSHOT_CHILD_FILES: [
          join(advancedScenarioDir, 'session.1.jsonl'),
          join(advancedScenarioDir, 'session.2.jsonl'),
        ].join(delimiter),
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(3)
        const parents = logs.filter(log => typeof log.header.parentSession !== 'string')
        expect(parents).toHaveLength(1)
        const parent = parents[0]
        if (parent === undefined) throw new Error('headless snapshot did not persist its main session')
        const children = logs.filter(log => typeof log.header.parentSession === 'string')
          .sort((left, right) => Number(left.header.createdAt) - Number(right.header.createdAt))
        const actualSessions = [parent, ...children]
        const actualContext = contextFromLogs(actualSessions.map(log => log.content))
        if (refreshing) {
          const harvested = actualSessions.map((log): HarvestedLog => ({
            id: String(log.header.id),
            createdAt: Number(log.header.createdAt),
            ...typeof log.header.parentSession === 'string'
              ? { parentSession: log.header.parentSession }
              : {},
            content: log.content,
          }))
          const replacements = refreshFixtureReplacements(harvested, expectedSessions)
          expectedSessions = await Promise.all(actualSessions.map(async (actual, index) => {
            const existing = expectedSessions[index]
            const file = fixtureFiles[index]
            if (existing === undefined || file === undefined) {
              throw new Error(`headless snapshot has no fixture for persisted log ${index}`)
            }
            const stable = projectSessionFixture(tokenizeSessionFixtureCwd(
              stabilizeRefreshLog(actual.content, existing, replacements, actualContext),
            ))
            await writeFile(file, stable)
            return stable
          }))
        }
        const expectedContext = contextFromLogs(expectedSessions)
        for (const [index, actual] of actualSessions.entries()) {
          const expected = expectedSessions[index]
          if (expected === undefined) throw new Error(`headless snapshot has no fixture for persisted log ${index}`)
          expect(normalizeSessionSnapshot(actual.content, actualContext))
            .toBe(normalizeSessionSnapshot(expected, expectedContext))
        }
      },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(advancedStreamExpected, normalized)
    expect(normalized).toBe(await readFile(advancedStreamExpected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('runs a keyless Agent Team with peer mail, dependent tasks, waiting, and Lead aggregation', async () => {
    let projection: unknown
    const result = await runLoaderSmoke({
      label: 'Agent Teams headless snapshot',
      tempDirPrefix: 'headless-snapshot-agent-team-',
      binScript,
      libBinScript: binScript,
      configPath: teamConfigPath,
      binArgs: [
        teamConfigPath,
        '请明确使用 Agent Teams，把调研和实现拆给两个 teammate，等待完成后汇总。',
      ],
      tsconfigPath,
      processTimeoutMs: 60_000,
      env: {
        DSH_SNAPSHOT: 'team',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        const parent = logs.find(log => typeof log.header.parentSession !== 'string')
        if (parent === undefined) throw new Error('Agent Teams snapshot did not persist its Lead')
        const rows = parseJsonl(parent.content)
        const members = rows.filter(row => row.type === 'team/member')
          .map(row => ((row.data as JsonObject).member as JsonObject))
        const tasks = rows.filter(row => row.type === 'team/task')
          .map(row => ((row.data as JsonObject).task as JsonObject))
        const latestTasks = Object.values(Object.fromEntries(tasks.map(task => [String(task.subject), task])))
        projection = {
          sessions: logs.length,
          memberEdges: members.length,
          activeMembers: members.filter(member => member.phase === 'active').map(member => member.name).sort(),
          tasks: latestTasks.map(task => ({
            subject: task.subject,
            revision: task.revision,
            status: task.status,
          })).sort((left, right) => String(left.subject).localeCompare(String(right.subject))),
          queuedMessages: rows.filter(row => row.type === 'team/message/queued').length,
          deliveredMessages: rows.filter(row => row.type === 'team/message/delivered').length,
          waited: rows.some(row => row.type === 'tool/call'
            && (row.data as JsonObject).name === 'wait_agent'),
          checkedRoster: rows.some(row => row.type === 'tool/call'
            && (row.data as JsonObject).name === 'list_agents'),
        }
      },
    })
    expect(result.stderr).toBe('')
    expect(parseJsonl(result.stdout).at(-1)).toMatchObject({
      type: 'result',
      output: 'TEAM_WORKFLOW_OK: both teammates and dependent tasks completed.',
    })
    expect(projection).toMatchInlineSnapshot(`
      {
        "activeMembers": [
          "implementer",
          "researcher",
        ],
        "checkedRoster": true,
        "deliveredMessages": 2,
        "memberEdges": 4,
        "queuedMessages": 2,
        "sessions": 3,
        "tasks": [
          {
            "revision": 3,
            "status": "completed",
            "subject": "Implementation",
          },
          {
            "revision": 3,
            "status": "completed",
            "subject": "Research",
          },
        ],
        "waited": true,
      }
    `)
  }, 75_000)

  it('replays persisted goal tools through the one-shot app', async () => {
    const prompt = await scenarioPrompt(goalScenarioDir, 'goal-tools')
    const streamExpected = join(goalScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'goal tools headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-goal-tools-',
      binScript,
      libBinScript: binScript,
      configPath: goalConfigPath,
      binArgs: [goalConfigPath, prompt],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: join(goalScenarioDir, 'session.jsonl'),
        DSH_SNAPSHOT_OVERRIDE: join(goalScenarioDir, 'replay.override.json'),
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(1)
        const records = parseJsonl(logs[0]?.content ?? '')
        const calls = records.filter(record => record.type === 'tool/call')
          .map(record => (record.data as JsonObject | undefined)?.name)
        expect(calls).toEqual(['update_goal', 'create_goal', 'get_goal'])
        const probeResult = records.find((record) => {
          if (record.type !== 'tool/result') return false
          const data = record.data as JsonObject | undefined
          const message = data?.message as JsonObject | undefined
          const source = message?.source as JsonObject | undefined
          return source?.callId === 'call_goal_probe'
        })
        const probeData = probeResult?.data as JsonObject | undefined
        const probeMessage = probeData?.message as JsonObject | undefined
        const probeContent = probeMessage?.content as JsonObject[] | undefined
        expect(probeContent?.[0]?.isError).toBe(true)
        expect((probeData?.error as JsonObject | undefined)?.code).toBe('GOAL_NOT_FOUND')
        const goalChanges = records.filter(record => record.type === 'goal/change')
        expect(goalChanges).toHaveLength(1)
        const data = goalChanges[0]?.data as JsonObject | undefined
        const goal = data?.goal as JsonObject | undefined
        expect(data?.operation).toBe('create')
        expect(goal).toMatchObject({
          objective: 'Finish the headless goal-tool snapshot proof',
          phase: 'active',
          maxGoalRounds: 7,
        })
      },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeGoalStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('replays two fresh Ralph rounds through the one-shot app', async () => {
    const prompt = await scenarioPrompt(ralphScenarioDir, 'ralph-loop')
    const streamExpected = join(ralphScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'Ralph loop headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-ralph-loop-',
      binScript,
      libBinScript: binScript,
      configPath: ralphConfigPath,
      binArgs: [ralphConfigPath, prompt],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: join(ralphScenarioDir, 'session.jsonl'),
        DSH_SNAPSHOT_OVERRIDE: join(ralphScenarioDir, 'replay.override.json'),
        DSH_SNAPSHOT_CHILD_FILES: [
          join(ralphScenarioDir, 'session.1.jsonl'),
          join(ralphScenarioDir, 'session.2.jsonl'),
        ].join(delimiter),
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(3)
        const parent = logs.find(log => typeof log.header.parentSession !== 'string')
        if (parent === undefined) throw new Error('Ralph snapshot did not persist its parent session')
        const parentId = parent.header.id
        expect(typeof parentId).toBe('string')
        const children = logs.filter(log => typeof log.header.parentSession === 'string')
          .sort((left, right) => Number(left.header.createdAt) - Number(right.header.createdAt))
        expect(children).toHaveLength(2)
        expect(children.map(child => child.header.parentSession)).toEqual([parentId, parentId])
        expect(children.map(child => child.header.cwd)).toEqual([parent.header.cwd, parent.header.cwd])
        expect(parent.header.delegationDepth).toBe(0)
        expect(children.map(child => child.header.delegationDepth)).toEqual([1, 1])
        expect(children.map(child => child.header.seedLength)).toEqual([undefined, undefined])
        expect(new Set(children.map(child => child.header.id)).size).toBe(2)

        const parentRecords = parseJsonl(parent.content)
        const parentCalls = parentRecords.filter(record => record.type === 'tool/call')
        expect(parentCalls.map(record => (record.data as JsonObject | undefined)?.name)).toEqual(['ralph'])
        const parentResult = parentRecords.find(record => record.type === 'tool/result')
        const parentResultData = parentResult?.data as JsonObject | undefined
        const parentMessage = parentResultData?.message as JsonObject | undefined
        const parentContent = parentMessage?.content as JsonObject[] | undefined
        expect(parentContent?.[0]?.isError).toBe(false)
        expect(JSON.stringify(parentContent?.[0]?.content)).toContain('reported completion after 2 rounds')

        const childRecords = children.map(child => parseJsonl(child.content))
        const childPrompts = childRecords.map((records) => {
          const message = records.find(record => record.type === 'user/message')
          return JSON.stringify((message?.data as JsonObject | undefined)?.content)
        })
        expect(childPrompts[0]).toContain('Ralph round: 1 of 2.')
        expect(childPrompts[0]).toContain('(none — this is the first round)')
        expect(childPrompts[0]).not.toContain('ROUND_ONE_HANDOFF')
        expect(childPrompts[1]).toContain('Ralph round: 2 of 2.')
        expect(childPrompts[1]).toContain('ROUND_ONE_HANDOFF')
        for (const childPrompt of childPrompts) {
          expect(childPrompt).toContain('Prove two fresh Ralph rounds through the shipped headless app.')
          expect(childPrompt).not.toContain('Run a two-round fresh-agent Ralph loop')
        }
        for (const records of childRecords) {
          const calls = records.filter(record => record.type === 'tool/call')
          expect(calls.map(record => (record.data as JsonObject | undefined)?.name))
            .toEqual(['structured_output'])
        }
      },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('delivers a continuable child result without parent polling', async () => {
    const parentReplay = join(settlementScenarioDir, 'parent.replay.jsonl')
    const parentOverride = join(settlementScenarioDir, 'parent.override.json')
    const childReplay = join(settlementScenarioDir, 'child.replay.jsonl')
    const childExpected = join(settlementScenarioDir, 'child.expected.jsonl')
    const streamExpected = join(settlementScenarioDir, 'stream-json.expected.jsonl')
    const task = 'Start one continuable background subagent and answer from its completion notice. Do not call list_agents, send_message, job_output, or job_list.'
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'continuable settlement headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-subagent-settlement-',
      binScript,
      libBinScript: binScript,
      configPath: settlementConfigPath,
      binArgs: [settlementConfigPath, task],
      tsconfigPath,
      env: {
        // The override fully supplies the parent script; the child fixture
        // remains separate so replay binds it to the fresh child Session.
        DSH_SNAPSHOT_FILE: parentReplay,
        DSH_SNAPSHOT_OVERRIDE: parentOverride,
        DSH_SNAPSHOT_CHILD_FILES: childReplay,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(2)
        const parent = logs.find(log => typeof log.header.parentSession !== 'string')
        const child = logs.find(log => typeof log.header.parentSession === 'string')
        if (parent === undefined || child === undefined) throw new Error('missing persisted parent or child log')

        const parentRecords = parseJsonl(parent.content)
        const calls = parentRecords.filter(record => record.type === 'tool/call')
        expect(calls.map(record => (record.data as JsonObject | undefined)?.name)).toEqual(['subagent'])
        const callArguments = (calls[0]?.data as JsonObject | undefined)?.arguments
        if (typeof callArguments !== 'string') throw new Error('subagent call did not persist its arguments')
        expect(JSON.parse(callArguments)).not.toHaveProperty('run_in_background')

        const notices = parentRecords.flatMap((record) => {
          if (record.type !== 'agent/inbox/spliced') return []
          const inserted = (record.data as JsonObject | undefined)?.inserted
          if (!Array.isArray(inserted)) return []
          return (inserted as JsonObject[]).filter((message) => {
            const source = message.source as JsonObject | undefined
            return source?.kind === 'subagent-settled'
          })
        })
        expect(notices).toHaveLength(1)
        expect(JSON.stringify(notices[0])).toContain('CHILD_RESULT')

        const context = contextFromLogs([parent.content, child.content])
        const normalizedChild = normalizeSessionSnapshot(child.content, context)
        if (refreshing) await writeFile(childExpected, normalizedChild)
        await expect(normalizedChild).toMatchFileSnapshot(childExpected)
        expect(normalizedChild).toContain('CHILD_RESULT')
        expect(normalizedChild).not.toContain('"name":"report"')
      },
    })

    expect(result.stderr).toBe('')
    const records = parseJsonl(result.stdout)
    expect(records.at(-1)).toMatchObject({
      type: 'result',
      output: 'PARENT_RECEIVED_CHILD_RESULT',
    })
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('replays persistent PTY tools through the one-shot app', async () => {
    const input = JSON.parse(await readFile(join(ptyScenarioDir, 'input.json'), 'utf8')) as {
      steps?: { op?: unknown; text?: unknown }[]
    }
    const prompt = input.steps?.find(step => step.op === 'prompt')?.text
    if (typeof prompt !== 'string') throw new Error('pty-tools input has no prompt step')
    let expectedSession = await readFile(ptySessionFixture, 'utf8')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'headless persistent PTY snapshot',
      tempDirPrefix: 'headless-snapshot-pty-',
      binScript,
      libBinScript: binScript,
      configPath: ptyConfigPath,
      binArgs: [ptyConfigPath, prompt],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: ptySessionFixture,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: (cwd) => { runCwd = cwd },
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(1)
        const actual = logs[0]
        if (actual === undefined) throw new Error('headless PTY snapshot did not persist its session')
        const actualContext = contextFromLogs([actual.content])
        if (refreshing) {
          const harvested: HarvestedLog = {
            id: String(actual.header.id),
            createdAt: Number(actual.header.createdAt),
            content: actual.content,
          }
          const replacements = refreshFixtureReplacements([harvested], [expectedSession])
          expectedSession = projectSessionFixture(tokenizeSessionFixtureCwd(
            stabilizeRefreshLog(actual.content, expectedSession, replacements, actualContext),
          ))
          await writeFile(ptySessionFixture, expectedSession)
        }
        const expectedContext = contextFromLogs([expectedSession])
        expect(normalizeSessionSnapshot(actual.content, actualContext))
          .toBe(normalizeSessionSnapshot(expectedSession, expectedContext))
      },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(ptyStreamExpected, normalized)
    expect(normalized).toBe(await readFile(ptyStreamExpected, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
