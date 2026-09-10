# Agent Note：Smoke overlay 包来源

Status: implemented

[English](2026-09-10-smoke-overlay-package-provenance.md) | 中文

## Problem

Source 模式 smoke 测试通过 tsconfig paths 解析 workspace import，而交付 profile 的 Node 模块 fallback 只包含安装依赖闭包。因此，测试 overlay 可能加载某个插件，但 active-package inventory 无法找到它的 manifest。关闭 inventory 会让 transcript 通过，却没有保留已启用的请求准备行为。

## Decision

[loader-smoke harness](../../../../packages/test-support/loader-smoke/README.zh.md#overlay-package-provenance) 拥有仅供测试 overlay 使用的显式 `profilePackages` 映射。它校验真实目录的名称与版本，并在启动交付 CLI 前，只在测试拥有的 home 中创建包链接。headless adapter 显式声明 replay 包和各 composition 的额外包目录，涵盖 PTY、LSP、产品子代理、ACP 子代理与 Python code runtime。产品依赖图、profile 配置、inventory collector 和请求比较保持不变。

所属测试从 profile 路径解析被链接的 manifest，拒绝缺失或不匹配的包与非自有 home，并检查清理。Recorded-session replay 验证完整的 inventory-enabled 应用。无法解析的包仍然失败；模型重放成功不能代替这项检查。

## Alternatives considered

**关闭请求 inventory：** 绕过已启用的功能及失败语义，即使这些 metadata 没有出现在模型 transcript 中。

**把测试 provider 加入产品依赖：** 把测试装配问题变成交付安装的一部分。

**将 runtime 解析扩展到 workspace tsconfig：** 把产品 manifest 发现耦合到仅用于开发的 source launcher。显式真实包目录使该依赖留在测试 harness 内。

ACP 和 SDK replay 也显式声明这些映射。Built 模式下，replay 包缺失会使插件树在 provider 注册前激活失败；部分清理期间进入的请求随后可能暴露已关闭的持久句柄或 inactive context，而不是最初的 import 错误。ACP goal、ACP corpus 和 SDK corpus 比较均通过真实 built profile 执行，保持 inventory 启用且不修改 expected 输出。共享安装器在协议启动前拒绝缺失或身份不符的包，ACP harness 验证这些拒绝后的清理。

## Consequences

测试作者分别声明包来源与 Cordis overlay 行。两者都引用真实包身份；不使用合成 metadata 隐藏缺失包。Built 模式测试仍然需要真实构建的 exports。既有 profile fallback 与 snapshot ownership 决策继续有效；本记录只规定测试 overlay 装配。
