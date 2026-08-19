# Science Runtime

English | [中文](science.zh.md)

The Science family owns six required-on-read Session events, the host-local Runtime that produces environment/run/artifact facts, the model-facing Consumer, and browser transcript presentation. [`dsh-science-session`](../../packages/science/science-session) strictly validates the complete durable values, exposes a client-safe `science` Session projection, and registers artifact attachment extraction. [`dsh-science-runtime`](../../packages/science/science-runtime) owns `ctx.scienceRuntime`: it observes configured existing Conda prefixes, writes private scratch, executes Python/R, and imports run-produced PNG files through `ctx.attachments`. [`dsh-tool-science`](../../packages/science/tool-science) binds mode/environment on first use, renders `science:environment`, registers all five Science tools, and publishes Outcomes after evidence validation. [`dsh-client-ui-science`](../../packages/client/ui-science) renders chart and Outcome tool occurrences through the shared attachment loader, hosts the Science settings card keyed on the `science-runtime` namespace `@deepseek-ai/dsh-science-runtime/with-settings` registers, and adds a session-header action plus a read-only `conversation.details.view` Details entry — an artifact viewer with a tab strip over opened charts, an in-panel toolbar, and a provenance drill-in (code, execution log, messages, environment) per artifact version, plus the latest Outcome on its no-tab landing view. The built-in non-copyable `science` preset composes the Consumer with a narrow supporting roster but carries no Runtime row; the shipped Web bundle mounts `with-settings` with an intentionally empty profile map alongside it, and a live-capable Host otherwise mounts explicit Runtime configuration.

Source: [`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts), [`packages/science/science-session/src/types.ts`](../../packages/science/science-session/src/types.ts), and [`packages/science/tool-science/src/index.ts`](../../packages/science/tool-science/src/index.ts)

## Operations

`bindEnvironment` requires the exact live Science Session object, observes one allowlisted profile, and appends one complete `science/environment-bound` value. `startRun` writes the exact source, appends `science/run-started` before spawn, and returns a `ScienceRunHandle` with only `runId`, `done`, and idempotent `cancel()`. `commitChart` accepts one successful run started locally in the exact Session, resolves a regular non-symlink PNG inside its artifact directory, persists it through `ctx.attachments`, and appends the next immutable logical artifact version with `origin: 'model'` without publishing a Host path. A second live-Session Runtime operation returns `RUNTIME_BUSY`. The Runtime refuses a remote subprocess world and a sandbox that cannot report full enforcement before it creates owner markers, scratch, or Session events.

The registered client projection is distinct from complete Host replay. It retains path-free environment summaries, run status/history, artifact attachment references, the latest Outcome, and metrics while omitting prefix/executable paths, full fingerprints, source/scratch facts, authorizing request identities, and Runtime free-text failures.

Every probe and run uses direct argv, `environmentBase: 'empty'`, a fixed allowlist, owned cwd, and full `workspace-write` confinement. Python uses frozen isolated UTF-8 flags. R version discovery uses standalone `Rscript --version`; UTF-8 probes and runs use `--vanilla --encoding=UTF-8`. File-write confinement is not confidentiality: it does not isolate reads, network, syscalls, or scientific correctness.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxscienceruntime--scienceruntime"></a>

### `ctx.scienceRuntime` — `ScienceRuntime`

Folded local Science Runtime provider with public types free of Host paths.

```ts cordis-catalog
/**
 * Observe one configured existing Conda profile and append its whole-value
 * environment revision. Static unusability becomes an honest `invalid`
 * revision; capability, cancellation, and I/O failures append nothing.
 * @param request - Exact live Session, profile identity, and caller signal.
 * @returns The accepted durable environment revision.
 */
async bindEnvironment(request: BindScienceEnvironmentRequest): Promise<ScienceEnvironmentBinding>

/**
 * Publish a direct-argv run start, then settle exactly one matching terminal
 * fact after the shared subprocess provider proves tree quiescence.
 * @param request - Exact live Session, source, authorization facts, and cancellation.
 * @returns A handle exposed only after `science/run-started` committed.
 */
async startRun(request: StartScienceRunRequest): Promise<ScienceRunHandle>

/**
 * Re-commit an existing artifact version's exact attachment reference with
 * a curated title and caption: metadata-only, so it never reads or writes
 * the filesystem and never calls the attachment store, and it supersedes
 * the version it names rather than opening a new one whose bytes would
 * repeat their predecessor's. A committed event is never rolled back
 * because a later step fails; there is no later step here that can fail
 * after the append.
 * @param request - Exact live Session, target logical artifact (and optional version), title/caption, and cancellation.
 * @returns The durable curated version this operation committed.
 */
annotateArtifact(request: AnnotateScienceArtifactRequest): Promise<ScienceArtifactVersion>
```

Source: [`packages/science/science-runtime/src/index.ts:92`](../../packages/science/science-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
