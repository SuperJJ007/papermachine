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

P1 骨架暂时禁用 Science 运行时、投影、编辑、附件索引和 UI 配置行。临时 Science preset 在模型请求前拒绝 `agent/pre-step`。P2 负责 Host 配置行及替代的受限 preset，P4 负责 UI 配置行。对应迁移验收前不支持启用这些行。

## Model Experience

临时 preset 拒绝执行，不提供 Science 工具或模型响应。

#### KV Cache effect

临时 preset 在请求前拒绝回合，因此无影响。

## Known Limitations and Deferred Work

- 此包仍是迁移骨架，Science 执行和产物侧栏尚不可用。浏览器验收需要编译后的品牌包和匹配的 Web 产物；仅导出配置不能证明浏览器激活成功。
