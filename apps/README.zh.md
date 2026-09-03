# Apps

[English](README.md) | 中文

可部署应用，每一个都是 `packages/` 之外自己的 workspace；package 分组见 [packages/README.md](../packages/README.zh.md)。

- [`cli`](cli) —— `@deepseek-ai/dsh`：`dsh` CLI（profile boot、plugin 管理、`dsh web` 别名）；已发布的 npm package。
- [`web`](web) —— `@deepseek-ai/dsh-web-frontend`：`dsh web` 提供服务的、由 Vite 构建的 Web 前端；已发布的 npm package。
- [`desktop`](desktop) —— `@deepseek-ai/dsh-desktop`：包装了一个独立 Host 生命周期的 Electron 桌面应用；已发布的 npm package。
- [`telemetry-receivers`](telemetry-receivers) —— `@deepseek-ai/dsh-telemetry-receivers`：desktop 使用统计 telemetry 的 Cloudflare Worker 与阿里云函数计算接收端；仅用于部署，`private: true`，从不发布。
