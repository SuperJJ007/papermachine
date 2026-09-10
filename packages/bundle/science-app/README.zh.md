---
description: "基于 dsh Web 应用的 PaperMachine 产品组合。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-science-app

[English](README.md) | 中文

## Summary

`science` profile 按顺序叠加 base、web-app 和 science-app。本 bundle 选择 Science preset、提供 PaperMachine 品牌配置行、禁用 preset 选择器与共享 HMR，并拥有 Science 插件配置。客户端产物使用 `DSH_CLIENT_BUILD_PROFILE=papermachine` 和 `DSH_CLIENT_TITLE=PaperMachine` 构建。

## Composition

bundle 的 Host 插件将其 preset 绝对目录提供为 `sciencePresetRoot`。agent-presets 配置行先注入该值，再求值配置中的根目录。因此 preset 路径跟随已安装的 bundle，不依赖进程工作目录。

Science 运行时、投影、编辑与读取服务、附件索引在 Host 挂载。Science UI 配置行在客户端迁移完成前保持禁用。Science preset 替换 base 中面向模型的工具配置行。

仓库命令 `pnpm papermachine` 和 `pnpm papermachine:headless "task"` 选择独立的 [PaperMachine 应用目录](../../util/home-paths/README.zh.md#papermachine-application-home)。迁移验收应显式指定 `PAPERMACHINE_HOME`；继承的 `DSH_HOME` 不决定 Science CLI 数据目录。

## Model Experience

该 preset 提供 Python 和 R 执行、产物发布、只读工作区工具及受限委派。

#### KV Cache effect

Science 身份提示和工具定义在会话中保持稳定；运行时上下文变更记录为用户消息。

## Known Limitations and Deferred Work

- 产物侧栏等待客户端迁移。浏览器验收需要匹配的 Web 和品牌构建产物。

使用 `dsh --profile science-headless` 执行一次性 Science 任务，或使用 `dsh --profile science` 启动 Web 界面。运行 Python 或 R 前，在 Host Science Runtime 的 `profiles.science` 配置允许使用的 Conda 前缀。内置 Science 预设提供只读工作区工具，并禁止复制。
