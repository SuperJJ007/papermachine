# Agent Note: 项目文件库

Status: implemented

[English](2026-08-26-project-file-library.md) | 中文

## Problem

Science Details 视图只能发现当前 Session fold 得到的 artifact。因此，即使 project artifact store 已经拥有共享的持久 artifact 历史，同一 workspace 中其他 Session 产生的 artifact 和普通 workspace 文件也没有 project 级浏览入口。

## Decision

`sessions.scienceLibrary` RPC 只通过具名 Session header 的 `cwd` 推导 project，并为每个 project artifact 返回一条最新版本记录。请求不提供 project id。来源 Session 标题是可选的展示信息；可用时从该 Session fold 得到，缺失时既不隐藏 artifact，也不新增事件。

`sessions.scienceArtifact` 保留原有的 Session fold 和跨 Session input 两条鉴权路径。如果二者都不能证明被请求版本，它会通过具名 Session 的 `cwd` 推导 project，并接受精确的 `getVersion(projectId, versionId)` 命中。只有 project artifact store 证明两个 Session 归属同一 project 时，才允许跨 Session 读取。根目录位于另一 workspace 的 Session 会推导出不同 project，无法使用这条路径。

`sessions.workspaceFiles` 和 `sessions.workspaceFile` 提供以具名 Session 的规范化 workspace 为根的有界只读视图。路径必须是相对路径，拒绝绝对路径和父目录 segment，并在 containment check（包含性检查）前规范化，因此 symlink 无法逃逸 workspace。目录读取只列一层，省略隐藏条目、符号链接和 `node_modules`，并在 2,000 个可见条目处停止，同时返回明确的截断事实。文件读取上限为 2 MiB。只有 Science 预览支持的扩展名会得到可渲染 media type；其他文件统一以 `application/octet-stream` 返回，由 UI 显示不支持预览状态。

浏览器 selection store 现在保存 artifact tab 与 file tab 组成的有序联合。artifact tab id 仍为 `artifact:<artifactId>`，同一逻辑 artifact 继续去重，并在原 tab 中切换所选版本。file tab id 为 `file:<relative path>`。活动 tab 为 null 时显示文件库主页，但不关闭其他 tab。Details header 选择一级「产物」或「项目文件」页；下方共用的文档 tab 条只在已有打开文档时出现。关闭最后一个文档后回到所选文件库页。

三个 RPC 都是只读操作，不追加 Session 事件。project 文件库每次显示时都会刷新，当前 Session 的 Science artifact 投影变化时也会刷新；它不轮询其他 Session 的写入。

## Alternatives considered

**使用 `host.listDirectory`。** 拒绝，因为它是 host 目录选择器 API，不会从具名 Session 的 workspace 推导权限。

**由浏览器发送 `projectId`。** 拒绝，因为客户端提供的不透明 project id 会削弱现有的 Session scoped authorization（Session 范围鉴权）规则。Host 能从持久 Session 状态推导 project。

**把跨 Session artifact 复制到当前 Session log。** 拒绝，因为浏览不是 model-visible input（模型可见输入），不应制造合成 provenance（来源信息）或复制持久证据。

**轮询文件库。** 拒绝，因为返回主页已经提供确定的刷新点；轮询会增加后台工作，同时仍无法提供事务性通知保证。

## Consequences

同一 workspace 现在拥有一个覆盖多个 Session 的可浏览 artifact 文件库，而不同 workspace 继续由规范化 project 解析隔离。普通文件可以预览，但不会开放任意 host 文件系统访问。UI 增加了第二种文档类型，并且必须按其 kind 做穷尽 switch。其他 Session 的变化会在下次进入文件库时出现，不会在 viewer 持续打开时立即出现。由于文件库 RPC 只返回最新版本记录，其他 Session 的 artifact 以仅含最新版本的只读预览打开；只有当前 Session 投影提供该 artifact 历史时，版本步进和编辑控件才可用。
