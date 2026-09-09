import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp, readdir, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const repo = '/Users/superjj/ccproj/pm-replant'
const { Context } = await import(pathToFileURL(join(repo, 'vendor/cordis/lib/index.js')))
const { default: Jsonl } = await import(pathToFileURL(join(repo, 'packages/session/session-persistence-jsonl/lib/index.js')))
const samples = JSON.parse(await readFile('/private/tmp/pm-p3-legacy-metadata.json', 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const results = []
for (const sample of samples) {
  const root = await mkdtemp(join(tmpdir(), 'p3-real-v0-'))
  const directory = join(root, basename(dirname(dirname(sample.path))), sample.header.id)
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'session.jsonl.zstd')
  const original = await readFile(sample.path)
  assert.equal(hash(original), sample.sha256)
  const originalStat = await stat(sample.path)
  await writeFile(path, original)
  const initial = await stat(path)
  const ctx = new Context()
  const attempts = []
  try {
    await ctx.plugin(Jsonl, { root, compression: 'zstd' })
    for (const access of ['read', 'write']) {
      let error
      try {
        const handle = await ctx.sessionPersistence.open(sample.header.id, access)
        await handle.close()
      } catch (caught) { error = caught }
      assert(error, `${sample.category} ${access} unexpectedly succeeded`)
      assert.match(error.message, /science\//)
      assert.equal(hash(await readFile(path)), sample.sha256)
      assert.equal((await stat(path)).ino, initial.ino)
      assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.jsonl') || name.endsWith('.zstd')), ['session.jsonl.zstd'])
      attempts.push({ access, refused: true, errorName: error.name, message: error.message.replace(path, '<isolated-copy>/session.jsonl.zstd'), unchanged: true, noSuccessor: true })
    }
    assert.equal(hash(await readFile(sample.path)), sample.sha256)
    const finalStat = await stat(sample.path)
    assert.equal(finalStat.ino, originalStat.ino)
    assert.equal(finalStat.mtimeMs, originalStat.mtimeMs)
    results.push({ category: sample.category, version: sample.header.version, bytes: original.length, sha256: sample.sha256, originalUnchanged: true, attempts })
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}
await writeFile(join(repo, '.agents/migrations/0.1.5/evidence/P3/real-v0.json'), JSON.stringify(results, null, 2) + '\n')
console.log('PASS: three real V0 logs, six read/write refusals; originals and copies unchanged; no successor.')
