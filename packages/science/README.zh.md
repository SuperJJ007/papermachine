# science/：Science 领域家族

[English](README.md) | 中文

Science 领域：required-on-read Session 事件、host-local Runtime 操作、严格重放、invariant 校验、客户端安全的 `science` Session projection，以及面向模型的五工具 Consumer。内置 preset 与浏览器会话记录行属于应用/客户端组合；设置与当前状态 Details 仍是后续工作。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`science-artifact-store/`](science-artifact-store/README.zh.md) | Project 拥有的 artifact 注册表：工作区身份、每个 Project 一份 SQLite 索引加内容寻址 blob，以及跨 Project 内各 Session 共享的线性追加操作。 | `ctx.scienceArtifactStore` |
| [`science-session/`](science-session/README.zh.md) | 拥有七个 Science Session 事件、严格 Host replay、pre-commit invariant、客户端安全 projection 与 artifact 附件提取。 | 组合时注册到 `ctx.sessionProjections` / `ctx.sessionAttachments` |
| [`science-runtime/`](science-runtime/README.zh.md) | Host-local Conda Runtime：environment binding、按 (session, language) 持久化的 Python/R kernel execution、私有 scratch、run 写出文件的自动捕获，以及纯元数据的 artifact 策展。 | `ctx.scienceRuntime` |
| [`tool-science/`](tool-science/README.zh.md) | 面向模型的 Consumer：首次使用 binding/context，以及 `get_science_state`、`run_python`、`run_r`、`annotate_artifact`、`publish_outcome`。 | 注册到 `ctx.tools` / `ctx.systemPrompt` |

子级 README 负责 event、replay、projection、Runtime 与 Consumer 约定。浏览器展示位于 [`client/ui-science`](../client/ui-science/README.zh.md)。
