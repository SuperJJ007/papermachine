# science/：Science 领域家族

[English](README.md) | 中文

Science 领域：required-on-read 的 Session 事件、宿主本地 Runtime 操作、严格重放、invariant 校验，以及可选的 `science` session projection。工具、preset 与客户端包仍属后续切片。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`science-session/`](science-session/README.md) | 拥有六个 Science Session 事件、其严格 fold、pre-commit invariant，以及可选的 `science` projection。 | （组合时注册到 `ctx.sessionProjections`） |
| [`science-runtime/`](science-runtime/README.md) | 折叠的宿主本地 Conda Runtime：`bindEnvironment`、`startRun`、私有 scratch，以及这些操作追加的 environment/run Session 事件。 | `ctx.scienceRuntime` |

子级 README 负责事件、重放、projection 与 Runtime 约定。
