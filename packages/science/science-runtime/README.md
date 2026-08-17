# @deepseek-ai/dsh-science-runtime

English | [中文](README.zh.md)

`@deepseek-ai/dsh-science-runtime` provides the folded, host-local Conda Runtime for durable Science environment, run, and chart facts. It owns `ctx.scienceRuntime`, private per-Session scratch, direct Python/R argv construction, stable prefix observation, exact-Session leases, terminal result classification, and PNG import into the attachment store. It registers no model-facing tool, prompt, preset, or UI.

## Composition

Load `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-science-session`, `@deepseek-ai/dsh-attachment-local`, `@deepseek-ai/dsh-subprocess-local`, `@deepseek-ai/dsh-sandbox-local`, and this package on the Host; select `@deepseek-ai/dsh-science-session/invariant` where Science Session facts are admitted. The Runtime requires attachment, `host-local` subprocess, and full-enforcement sandbox providers. Its `./invariant` companion has no duplicate event relation because the Science Session invariant owns durable stream validation.

The package configuration names existing absolute Conda prefixes. It does not invoke Conda or create, clone, update, install into, repair, or delete a prefix.

```yaml
- name: '@deepseek-ai/dsh-science-runtime'
  config:
    dshHome: /absolute/test-owned/dsh-home
    timeoutMs: 120000
    profiles:
      analysis:
        pythonPrefix: /absolute/conda/python
        rPrefix: /absolute/conda/r
```

`profiles` is a closed map keyed by `ScienceEnvironmentProfileId`. An empty map is a valid explicit unconfigured state; each declared value still has at least one absolute `pythonPrefix` or `rPrefix`. `timeoutMs` defaults to 120,000 and accepts only safe integers from 1 through 600,000.

## Settings-bound entry

`@deepseek-ai/dsh-science-runtime/with-settings` provides the same service over the same `Config`, and additionally resolves `profiles` through the restart-scoped `science-runtime` user-settings namespace, which holds only that map. The Cordis `profiles` map is its composition `base`. The Runtime snapshots the resolved map once at load and does not watch it, so a successful write changes only the next Host start. `pythonPrefix` and `rPrefix` are write-only secrets on every browser-facing settings descriptor.

That entry declares `settings` among its injections, which is what fixes the resolution order: Cordis constructs it only once the settings provider is ACTIVE. A composition that mounts it without a settings provider leaves it PENDING on the unmet injection. Deployments that own their profile map in configuration alone mount the root entry, which never reads settings.

Both entries provide the same `ctx.scienceRuntime` Cordis service, and that service holds exactly one provider: they are alternatives, never mounted together. The shipped Web bundle mounts `with-settings` by default under the Cordis entry id `science-runtime`; a deployment that instead owns its profile map in Cordis configuration overrides that row by id (a patch replacing the row, matching every other bundle-row override) rather than `insert`ing a second Runtime row — inserting a second row throws `service "scienceRuntime" has been registered` at load.

## Operations

`bindEnvironment({ session, profileId, signal })` requires the exact live Science Session object, observes the selected profile, and appends one complete `science/environment-bound` value. Static missing or unusable interpreters become an `invalid` value; cancellation, timeout, prefix I/O failure, partial confinement, or an overlapping writable root rejects without an environment event.

`startRun({ session, language, code, toolCallId, requestHeaderSeq, signal })` re-observes the applied binding, writes unchanged UTF-8 source into a private run directory, appends `science/run-started`, and returns a `ScienceRunHandle`. The handle exposes only `runId`, `done`, and idempotent `cancel()`; it exposes neither a PID nor Host scratch paths. Its resolved result carries the committed terminal record plus bounded operational stdout/stderr tails, exact byte counts, and truncation facts. Output text never enters a Science Session event.

`commitChart({ session, runId, artifactPath, logicalName, title, caption, toolCallId, requestHeaderSeq, signal })` accepts only a successful run started locally in the exact Session, resolves one regular non-symlink PNG below that run's private `SCIENCE_ARTIFACT_DIR`, and reads at most the attachment store's byte cap plus one. `ctx.attachments.saveImage` remains the media admission authority. The Runtime persists the attachment before appending a complete `science/chart-saved` version, retains a stable chart id across one logical name's contiguous versions, and publishes no Host path.

The Runtime rejects pre-publication misuse or capability failures with `ScienceRuntimeError`. After a start event commits, ordinary process, runner, denial, cancellation, and timeout outcomes append one matching terminal event. If bounded settlement cannot prove whole-tree quiescence, `done` rejects while the Runtime retains the lease; a later positive proof appends the terminal fact before releasing a still-live Session, while a false or rejected proof keeps it quarantined. `done` also rejects when a still-live Session cannot commit the terminal fact or an unexpected detached Session makes a commit forbidden.

## Confinement and environment

Every probe and run uses direct argv, an empty subprocess environment base, a fixed environment allowlist, owned cwd, and full `workspace-write` confinement. Python uses `-I -B -X utf8` for probes and adds `-u` for runs. R version discovery uses standalone `Rscript --version`; its UTF-8 probe and runs use `Rscript --vanilla --encoding=UTF-8`. The Runtime refuses a Conda prefix that overlaps any writable root, and never grants the project directory as its workspace.

The private root is derived under `DSH_HOME/science/v1/` with an exclusive mode-0600 owner marker and mode-0700 directories. Only the operation whose exclusive marker creation succeeds receives rollback ownership; a materialization failure removes that operation's exact marker and Session root after verifying the marker bytes, while concurrent or pre-existing ownership is retained. A live operation reserves the exact Session object; a same-ID successor remains quarantined until an older detached lifecycle proves all owned trees are quiescent. Accepted run directories remain for state and diagnostics, while unpublished probe directories are removed only after quiescence.

## Verification

Fake-prefix tests cover Python-only, R-only, shared and distinct prefixes; strict configuration; stable and drifted observations; invalid UTF-8 probe bytes; scratch ownership; direct argv; empty environments; output bounds; terminal classifications; cancellation; timeout; detachment; same-ID quarantine; Loader composition; and live/cold replay. The lstat-only prefix manifest records relative path, type, symlink target, mode, size, mtime/ctime nanoseconds, and regular-file digest without using atime; an empty before/after diff is the prefix-unchanged result.

Real Conda acceptance is separate and opt-in. It never treats fake-prefix evidence as real-machine evidence.

```sh
DSH_SCIENCE_RUNTIME_REAL_ACCEPTANCE=1 \
DSH_SCIENCE_RUNTIME_TEST_OWNED=1 \
DSH_SCIENCE_RUNTIME_DSH_HOME=/absolute/test-owned/dsh-home \
DSH_SCIENCE_RUNTIME_PYTHON_PREFIX=/absolute/conda/python \
DSH_SCIENCE_RUNTIME_R_PREFIX=/absolute/conda/r \
pnpm --filter @deepseek-ai/dsh-science-runtime test:real-acceptance
```

The command reports Python and R independently as `PASS`, `FAIL`, or `NOT-RUN`; absent opt-in inputs produce `NOT-RUN`. A selected language verifies canonical prefix/executable/history identity, non-ASCII direct source/output, empty-environment behavior, owned directories, full confinement, cancellation, timeout, prefix-write denial, managed-tree settlement, and an unchanged prefix manifest.

## Model Experience

None, as the Runtime exposes non-model-facing operations consumed by `@deepseek-ai/dsh-tool-science` and registers no prompt context.

#### KV Cache effect

None; the Runtime neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **No environment management** — the Runtime consumes explicit existing prefixes; it does not discover, create, install into, update, repair, or delete Conda environments.
- **Existing local prefixes only** — observations are fingerprints, not reproducible-environment locks, and the Runtime never manages Conda packages or environments.
- **File-write confinement only** — full sandbox enforcement limits documented file writes but does not claim file-read, network, syscall, or scientific-validity isolation.
- **Host-local execution only** — a remote subprocess provider and a partial sandbox backend fail closed because this implementation owns private Host scratch.
