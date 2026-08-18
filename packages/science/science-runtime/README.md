# @deepseek-ai/dsh-science-runtime

English | [中文](README.zh.md)

`@deepseek-ai/dsh-science-runtime` provides the folded, host-local Conda Runtime for durable Science environment, run, and artifact facts. It owns `ctx.scienceRuntime`, private per-Session scratch, direct Python/R argv construction, stable prefix observation, exact-Session leases, terminal result classification, auto-capture of run-written files into versioned artifacts, and metadata-only curated re-annotation of an already-captured artifact version. It registers no model-facing tool, prompt, preset, or UI.

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

`profiles` is a closed map keyed by `ScienceEnvironmentProfileId`. An empty map is a valid explicit unconfigured state; each declared value still has at least one absolute `pythonPrefix` or `rPrefix`. `timeoutMs` defaults to 120,000 and accepts only safe integers from 1 through 600,000. `packagesMaxEntries` (default 2,000; 1 through 20,000) and `packagesMaxBytes` (default 65,536; 1,024 through 1,048,576) bound the package inventory retained per observed interpreter, described under Operations below. `captureMaxFileBytes` (default 5 MiB; 1 through 50 MiB), `captureMaxFilesPerRun` (default 50; 1 through 1,000), and `captureMaxArtifactVersionsPerSession` (default 500; 1 through 10,000) bound auto-capture, described under Auto-capture below. Curation (`annotateArtifact`) never reads the filesystem or the attachment store, so it has no byte or count bound of its own.

## Settings-bound entry

`@deepseek-ai/dsh-science-runtime/with-settings` provides the same service over the same `Config`, and additionally resolves `profiles` through the restart-scoped `science-runtime` user-settings namespace, which holds only that map. The Cordis `profiles` map is its composition `base`. The Runtime snapshots the resolved map once at load and does not watch it, so a successful write changes only the next Host start. `pythonPrefix` and `rPrefix` are write-only secrets on every browser-facing settings descriptor.

That entry declares `settings` among its injections, which is what fixes the resolution order: Cordis constructs it only once the settings provider is ACTIVE. A composition that mounts it without a settings provider leaves it PENDING on the unmet injection. Deployments that own their profile map in configuration alone mount the root entry, which never reads settings.

Both entries provide the same `ctx.scienceRuntime` Cordis service, and that service holds exactly one provider: they are alternatives, never mounted together. The shipped Web bundle mounts `with-settings` by default under the Cordis entry id `science-runtime`; a deployment that instead owns its profile map in Cordis configuration overrides that row by id (a patch replacing the row, matching every other bundle-row override) rather than `insert`ing a second Runtime row — inserting a second row throws `service "scienceRuntime" has been registered` at load.

## Operations

`bindEnvironment({ session, profileId, signal })` requires the exact live Science Session object, observes the selected profile, and appends one complete `science/environment-bound` value. Static missing or unusable interpreters become an `invalid` value; cancellation, timeout, prefix I/O failure, partial confinement, or an overlapping writable root rejects without an environment event. Each available interpreter's identity also carries a package inventory: name/version pairs sorted and digested over the complete observation, then retained up to `packagesMaxEntries`/`packagesMaxBytes`; exceeding either cap truncates the retained list and sets `packagesTruncated`, while the digest still covers the complete pre-truncation inventory. A package-inventory probe that does not produce parseable output makes the whole interpreter observation `invalid`, matching the version and UTF-8 probes' honest-failure behavior.

`startRun({ session, language, code, toolCallId, requestHeaderSeq, signal })` re-observes the applied binding, writes unchanged UTF-8 source into a private run directory, appends `science/run-started`, and returns a `ScienceRunHandle`. The handle exposes only `runId`, `done`, and idempotent `cancel()`; it exposes neither a PID nor Host scratch paths. Its resolved result carries the committed terminal record plus bounded operational stdout/stderr tails, exact byte counts, and truncation facts. Output text never enters a Science Session event.

### Auto-capture

Immediately after every run's terminal fact commits — success, failed, timed-out, or cancelled alike — the Runtime walks that run's private `SCIENCE_ARTIFACT_DIR` and durably saves every eligible file as the next version of the logical artifact named by its path relative to that directory (`plots/loss.png`, `summary.csv`). Eligible means: no dotfile or dot-directory path segment, and a lower-cased extension in the fixed allowlist `.csv`, `.json`, `.md`, `.png`, `.txt` — a file-format allowlist mirroring the attachment store's own frozen `mediaTypes` set, not a Loader-exposed knob. A captured version carries `origin: 'auto'` and a title equal to the file's basename; content addressing makes admission idempotent, so a byte-identical rerun of the same logical name is silently skipped rather than committing a redundant version.

`captureMaxFileBytes` bounds one file's admitted size (an oversized file is skipped and counted, never a run failure — including a deployment attachment cap narrower than this bound). `captureMaxFilesPerRun` bounds eligible files attempted from one run; the excess are truncated (not attempted) and flagged in the returned accounting. `captureMaxArtifactVersionsPerSession` bounds artifact versions a session accumulates through auto-capture across every run; once reached, capture stops appending further versions for the rest of that run (and every later run) and flags it, until a future retention pass reclaims headroom. A capture failure — an oversized file, a truncated cap, or an unexpected exception — never fails the run whose terminal fact already committed.

`annotateArtifact({ session, logicalName, version, title, caption, toolCallId, requestHeaderSeq, signal })` resolves the named logical artifact's exact `version` (or its latest, when omitted) against the live Science projection and re-commits its unchanged content-addressed `attachment` as the next contiguous version, carrying the supplied `title`/`caption` and `origin: 'model'`. It never reads the filesystem, never calls `ctx.attachments`, and never publishes a Host path; rejecting with `ARTIFACT_NOT_FOUND` is the only failure mode beyond the shared pre-publication ones, when `logicalName` or its named `version` does not exist in this session.

The Runtime rejects pre-publication misuse or capability failures with `ScienceRuntimeError`. After a start event commits, ordinary process, runner, denial, cancellation, and timeout outcomes append one matching terminal event, immediately followed by the auto-capture walk above. If bounded settlement cannot prove whole-tree quiescence, `done` rejects while the Runtime retains the lease; a later positive proof appends the terminal fact, runs its own auto-capture walk, and releases a still-live Session, while a false or rejected proof keeps it quarantined. `done` also rejects when a still-live Session cannot commit the terminal fact or an unexpected detached Session makes a commit forbidden.

## Confinement and environment

Every probe and run uses direct argv, an empty subprocess environment base, a fixed environment allowlist, owned cwd, and full `workspace-write` confinement. Python uses `-I -B -X utf8` for probes and adds `-u` for runs; its package-inventory probe adds `-m pip list --format=json`, reporting what the interpreter itself sees. R version discovery uses standalone `Rscript --version`; its UTF-8 probe and runs use `Rscript --vanilla --encoding=UTF-8`; its package-inventory probe evaluates `installed.packages()` and prints `Package`/`Version` as TSV using only base R, since `jsonlite` is not guaranteed present. The Runtime refuses a Conda prefix that overlaps any writable root, and never grants the project directory as its workspace.

The private root is derived under `DSH_HOME/science/v1/` with an exclusive mode-0600 owner marker and mode-0700 directories. Only the operation whose exclusive marker creation succeeds receives rollback ownership; a materialization failure removes that operation's exact marker and Session root after verifying the marker bytes, while concurrent or pre-existing ownership is retained. A live operation reserves the exact Session object; a same-ID successor remains quarantined until an older detached lifecycle proves all owned trees are quiescent. Accepted run directories remain for state and diagnostics, while unpublished probe directories are removed only after quiescence.

## Verification

Fake-prefix tests cover Python-only, R-only, shared and distinct prefixes; strict configuration; stable and drifted observations; invalid UTF-8 probe bytes; package-inventory parsing, sorting, entry/byte-cap truncation, and probe-failure handling for both languages; scratch ownership; direct argv; empty environments; output bounds; terminal classifications; cancellation; timeout; detachment; same-ID quarantine; Loader composition; and live/cold replay. A dedicated auto-capture suite covers a new file, a changed file, an identical rerun (skipped), an oversized file, the per-run and per-session caps, dotfile/extension exclusion, capture on a failed run, a deployment attachment-store admission rejection, and a non-fatal internal capture failure. A dedicated test pins `bindingFingerprint` as independent of the package inventory: rebinding the same static identity with a different observed inventory changes `packagesSha256` but not `bindingFingerprint`. The lstat-only prefix manifest records relative path, type, symlink target, mode, size, mtime/ctime nanoseconds, and regular-file digest without using atime; an empty before/after diff is the prefix-unchanged result.

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
- **A truncated package inventory cannot be replayed into an environment** — the digest still covers the complete inventory, so truncation is detectable, but a capped retained list is name/version pairs, not an installable specification. `bindingFingerprint` never folds in the package digest, so raising or lowering either cap does not change drift detection.
- **A mid-session package install is invisible until the next binding** — the inventory is captured once per environment binding, not per run; `condaHistorySha256` already catches conda-level mutation at that point.
- **Non-quiescent auto-capture has no synchronous model-visible signal** — the non-quiescent settlement branch's eventual terminal fact was already invisible to the model's current turn before this Runtime captured anything; its own auto-capture walk inherits that same asymmetry. The captured versions are durable `science/artifact-saved` events regardless, discoverable on the model's next `get_science_state` call; v1 adds no separate completion notification for this branch.
- **A crash between a run's terminal commit and its auto-capture walk leaves that run's files uncaptured** — with no automatic retry. This mirrors the existing pre-/post-`science/run-started` scratch-cleanup asymmetry and is accepted for v1; a future retention or reconciliation pass is the seam that would close it.
- **An auto-capture failure during the walk (not before it) also has no automatic retry** — an environmental fault (the artifact directory disappeared, a permission or disk error) or a defect in this Runtime's own capture logic both stop that run's walk with no run failure; the run's own terminal fact and result stand, and the failure is logged (`warn` for the environmental class, `error` for anything else) rather than silently absorbed, but the remaining eligible files in that run stay uncaptured until a future retention or reconciliation pass closes this gap the same way as the crash case above.
