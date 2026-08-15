# Science Runtime

English | [中文](science.zh.md)

The Science family owns required-on-read Session events and the host-local Runtime that produces environment and run facts. [`dsh-science-session`](../../packages/science/science-session) validates and projects those events. [`dsh-science-runtime`](../../packages/science/science-runtime) owns `ctx.scienceRuntime`: it observes configured existing Conda prefixes, binds a live Science Session, writes private scratch, and appends `science/environment-bound`, `science/run-started`, and `science/run-finished`. It registers no model tool, prompt, preset, or client UI.

Source: [`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts) and [`packages/science/science-session/src/types.ts`](../../packages/science/science-session/src/types.ts)

## Operations

`bindEnvironment` requires the exact live Science Session object, observes one allowlisted profile, and appends one complete `science/environment-bound` value. `startRun` writes the exact source, appends `science/run-started` before spawn, and returns a `ScienceRunHandle` with only `runId`, `done`, and idempotent `cancel()`. A second live-Session operation returns `RUNTIME_BUSY`. The Runtime refuses a remote subprocess world and a sandbox that cannot report full enforcement before it creates owner markers, scratch, or Session events.

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
```

Source: [`packages/science/science-runtime/src/index.ts:65`](../../packages/science/science-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
