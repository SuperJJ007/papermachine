---
description: "PaperMachine 浏览器品牌组件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-papermachine

[English](README.md) | 中文

## Summary

当 `DSH_CLIENT_BUILD_PROFILE` 为 `papermachine` 时，此浏览器插件填充侧栏图标、侧栏名称和会话首页图标。启用其 Loader 配置行，并以 `DSH_CLIENT_TITLE=PaperMachine` 构建客户端产物来设置文档标题。标题由构建配置拥有；插件不提供品牌服务。

## Registration

三个组件通过感知槽位声明的 `slots.inject()` 注册，在声明或插件销毁时退出。非 PaperMachine 构建不会注册任何组件。Node 入口不执行操作。

图标使用共享的 `FishLogo`。文字标识通过系统字体呈现“PaperMachine”，两个部分使用不同字重，颜色使用主题令牌。

## Model Experience

浏览器展示不贡献模型输入或会话事件。

#### KV Cache effect

无；插件不组装提供方请求。

## Known Limitations and Deferred Work

在专用 PaperMachine 图标就绪前使用共享图案。运行时 profile 变更不能改变现有客户端产物中的品牌；需要使用目标公开环境重新构建。
