# Agent Note: Science 工具组装及运行时所有权

Status: implemented

[English](2026-08-16-dsh-science-v01-r3-science-tools.md) | 中文

## 问题

Science 工具需要在执行前获得环境，但不应让提前发现成为每个会话的前提，也不应在重建请求时重复 provider 工作。

## 决策

工具消费者通过异步组装等待惰性绑定，并把执行交给 ScienceRuntime。Science preset 选择只读文件系统入口及精选 Science 工具集。部署策略拥有复制资格、MCP 筛选及保留请求上下文；上下文重试复用已保留的 provider 结果，不重复调用。

工具 schema 暴露类型化请求，领域 admission 仍由 Runtime 负责。状态和安装结果必须描述实际记录的环境，不能由配置路径推断就绪。产品与 headless preset 共用 Science composition。

## 考虑过的替代方案

**提前绑定所有环境。** 这会让从不使用 Science 的会话承担解释器探测，并把组装与 Host 就绪耦合。

**允许模型任意使用 shell 或修改文件系统。** 这会绕过 Runtime 的观察与捕获。

**重试时重复 provider 工作。** 重试将改变副作用和观察输入，而不是重建同一已获准请求。

## 后果

异步组装必须传播绑定失败；已配置但不可用的环境不能被静默跳过。随部署变化的工具和裁剪策略仍为经过验证的配置。Preset 不会让未记录的外部包修改变得可重现。

## 相关决策

相关 owner：[science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md); [science-run-tool-exact-version-inputs](2026-08-22-science-run-tool-exact-version-inputs.zh.md).
