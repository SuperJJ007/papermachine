# Agent Note: 部署级 MCP 工具筛选

Status: implemented

[English](2026-09-01-mcp-tool-curation.md) | 中文

## 问题

Science preset 即使约束内置工具，仍可能意外暴露宽权限 MCP server 的执行或修改工具。启动后的工具清单变化也需要相同策略。

## 决策

MCP 筛选在加载时及 generation 改变清单时，依据声明的 server/tool 策略选择允许的远程工具。名字像只读操作不证明安全。筛选发生在模型暴露前，底层清单仍由 server owner 拥有。配置引用缺失或无效必须明确失败。

Science preset 与部署策略 owner 选择精选集合。筛选不能替代运行时文件系统或子进程隔离。

## 考虑过的替代方案

**只过滤第一次 tools/list。** 重连或后续清单更新可能重新引入已排除工具。

**仅在 UI 隐藏而保留模型 schema。** 模型仍可调用排除操作。

**由工具名猜测安全性。** 远程名称不证明行为或权限。

## 后果

清单刷新后，模型仍看到由策略决定的子集。允许的远程工具仍使用 server 自身权限执行；筛选是暴露策略，不是 server 的 sandbox。

## 相关决策

相关 owner：[science-preset-deployment-policy](../architecture/2026-09-09-science-preset-deployment-policy.zh.md).
