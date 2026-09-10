# Agent Note: Fork 集成工作流归属

Status: implemented

[English](2026-09-11-fork-integration-workflow-ownership.md) | 中文

## 问题

PaperMachine 拉取请求继承了为上游项目看板创建 App 令牌及向上游 Cloudflare 项目部署预览的任务。远程验收因缺少上游 App 客户端 ID，在策略校验前失败。Fork 拉取请求不能隐式部署到不属于它的基础设施。

## 决策

[Issue 策略](../../../../.github/workflows/issue-policy.yml)、[Issue 生命周期](../../../../.github/workflows/issue-lifecycle.yml)及[预览](../../../../.github/workflows/build-preview-cloudflare.yml)任务要求 `github.repository == 'deepseek-harness/deepseek-harness'`，与 App 目标一致。Fork 在检出、创建令牌或部署前跳过这些任务。所属仓库内原有事件条件仍然生效。

[Fork runner 决策](2026-09-10-papermachine-fork-hosted-ci.zh.md)继续负责测试容量与必需检查。产品 CI、真实 API 测试、原生构建及无凭据发布打包保留原有条件。

## 考虑过的替代方案

**复制凭据或隐式改写集成目标。** PaperMachine 没有配置对应的 App 或受保护预览项目；仅有凭据不能确立目标归属。

**人工取消预览并接受策略失败。** 取消操作不能保护后续推送，无关的凭据失败会干扰验收结果。

## 后果

这些任务报告为跳过，而不是产品检查通过。未来的 PaperMachine 集成需要自己的已验证目标与授权。工作流规格测试拒绝缺失或变更的归属条件，同时保留事件、令牌及部署设置的断言。现有上游策略与 fork runner 笔记保留各自独立的决策依据；不修改归档记录。
