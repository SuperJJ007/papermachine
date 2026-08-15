# science/：Science 领域家族

[English](README.md) | 中文

Science 领域：required-on-read 的 Session 事件、宿主本地 Runtime 操作、严格重放、invariant 校验、可选的 `science` session projection，以及面向模型的 Consumer。Preset 与客户端包仍属后续切片。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`science-session/`](science-session/README.md) | 拥有六个 Science Session 事件、其严格 fold、pre-commit invariant，以及可选的 `science` projection。 | （组合时注册到 `ctx.sessionProjections`） |
| [`science-runtime/`](science-runtime/README.md) | 折叠的宿主本地 Conda Runtime：`bindEnvironment`、`startRun`、私有 scratch，以及这些操作追加的 environment/run Session 事件。 | `ctx.scienceRuntime` |
| [`tool-science/`](tool-science/README.md) | 面向模型的 Consumer：首次使用时绑定 mode/environment、`science:environment` 动态上下文，以及 `get_science_state`/`run_python`/`run_r` 工具，全部通过 `ctx.scienceRuntime` 完成。尚无已发布的组合。 | （注册到 `ctx.tools`／`ctx.systemPrompt`） |

子级 README 负责事件、重放、projection、Runtime 与 Consumer 约定。
