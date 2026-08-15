# Science Runtime

[English](science.md) | 中文

Science 家族拥有 required-on-read 的 Session 事件，以及产生 environment 与 run 事实的宿主本地 Runtime。[`dsh-science-session`](../../packages/science/science-session) 校验并投影这些事件。[`dsh-science-runtime`](../../packages/science/science-runtime) 拥有 `ctx.scienceRuntime`：它观测已配置的既有 Conda prefix，绑定一个活的 Science Session，写入私有 scratch，并追加 `science/environment-bound`、`science/run-started` 与 `science/run-finished`。它不注册模型工具、提示词、preset 或客户端 UI。

来源：[`packages/science/science-runtime/src/index.ts`](../../packages/science/science-runtime/src/index.ts) 与 [`packages/science/science-session/src/types.ts`](../../packages/science/science-session/src/types.ts)

## 操作

`bindEnvironment` 要求精确的活 Science Session 对象，观测一个允许列表中的 profile，并追加一条完整的 `science/environment-bound` 值。`startRun` 写入精确源码，在 spawn 前追加 `science/run-started`，并返回只包含 `runId`、`done` 与幂等 `cancel()` 的 `ScienceRunHandle`。同一活 Session 上的第二项操作返回 `RUNTIME_BUSY`。Runtime 在创建 owner marker、scratch 或 Session 事件之前，拒绝 remote subprocess 世界以及无法报告 full enforcement 的 sandbox。

每次 probe 和 run 都使用 direct argv、`environmentBase: 'empty'`、固定 allowlist、owned cwd 与 full `workspace-write` confinement。Python 使用冻结的 isolated UTF-8 标志。R 版本发现使用独立的 `Rscript --version`；UTF-8 probe 与 run 使用 `--vanilla --encoding=UTF-8`。file-write confinement 不是保密性：它不隔离 read、network、syscall 或科学正确性。

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
