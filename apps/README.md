# Apps

English | [中文](README.zh.md)

Deployable applications, each its own workspace outside `packages/`; package groups live at [packages/README.md](../packages/README.md).

- [`cli`](cli) — `@deepseek-ai/dsh`: the `dsh` CLI (profile boot, plugin management, the `dsh web` alias); published npm package.
- [`web`](web) — `@deepseek-ai/dsh-web-frontend`: the Vite-built web frontend `dsh web` serves; published npm package.
- [`desktop`](desktop) — `@deepseek-ai/dsh-desktop`: the Electron desktop app wrapping an isolated Host lifecycle; published npm package.
- [`telemetry-receivers`](telemetry-receivers) — `@deepseek-ai/dsh-telemetry-receivers`: the Cloudflare Worker and Aliyun Function Compute receivers for desktop usage telemetry; deployment-only, `private: true`, never published.
