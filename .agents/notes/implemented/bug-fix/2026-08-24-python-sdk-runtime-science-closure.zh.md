# Agent Note: 补全 Python SDK 内置 runtime 对 science preset 的闭包

Status: implemented

[English](2026-08-24-python-sdk-runtime-science-closure.md) | 中文

## Problem

`python/sdk-runtime/package.json` 的 `dependencies` 字段就是 Python SDK 内置 runtime 实际打包的可执行部署清单：`verify-runtime-closure` 要求它包含每一个已发布 agent preset 引用的插件，以及从已声明内容出发的传递 workspace peer 闭包，因为自动 peer 安装被关闭，遗漏其中任何一项否则只会在 Cordis 于生产环境加载打包插件时才暴露，事先没有任何本地信号。`science` preset（`apps/cli/config/agent-presets/science/agent.cordis.yml`）组合了 `@deepseek-ai/dsh-tool-science`，但这个包在 runtime 清单里完全不存在，它所需的 peer 依赖闭包——`@deepseek-ai/dsh-agent-presets`、`@deepseek-ai/dsh-science-runtime`、`@deepseek-ai/dsh-science-session`、`@deepseek-ai/dsh-session-attachment-index`——同样不存在。Python SDK 的使用者一旦选择已发布的 `science` preset，就会在 Cordis 加载阶段因缺失插件而失败，而不是在构建或测试阶段就被发现。

## Decision

先把 `@deepseek-ai/dsh-tool-science` 加入 runtime 清单的 `dependencies`，随后依次解决该 gate 级联报出的 peer 闭包缺口，加入 `@deepseek-ai/dsh-agent-presets`、`@deepseek-ai/dsh-science-runtime`、`@deepseek-ai/dsh-science-session`、`@deepseek-ai/dsh-session-attachment-index`——由于 `verify-runtime-closure` 是从已声明内容出发按广度优先遍历 peer 图，每一个缺口都是在补上前一个之后才会暴露出来。现在 `pnpm run verify-runtime-closure` 报告的是一个闭合的依赖图（5 个 preset，125 个 workspace 包）。

## Alternatives considered

**把 `science` preset 从 Python SDK 内置 runtime 发布的 preset 集合里去掉。** 不采用：该 preset 已经在名录中发布并可被选中；只在这一个部署目标里隐藏它，而其他目标继续正常提供，这是把产品能力回退包装成了构建修复，而当前的任务是补上一个已经存在的缺口，而不是缩小发布范围。

## Verification

`pnpm run verify-runtime-closure`（此前先在缺失 `dsh-tool-science` 这一行上失败，随后依次在每个被暴露出来的 peer 上失败；现在报告的是一个闭合的依赖图）。`pnpm run hygiene` 完整的 13 个 gate 全部通过。

## Consequences

Python SDK 内置的 runtime tarball 现在包含 `dsh-tool-science` 及其完整 peer 闭包，因此通过该 SDK 选择 `science` preset 时可以正常加载，不会再在 Cordis 插件解析阶段失败。内置 runtime 因此多打包了五个包的代码体积。
