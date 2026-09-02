# Agent Note：恢复 Science artifact 血缘、编辑摘要与策展授权

状态：已实现

[English](2026-09-02-science-artifact-receipts-restoration.md) | 中文

## 问题

[store 权威迁移](../architecture/2026-09-01-project-artifact-store-schema-v2.zh.md)把 producer、血缘、annotation 与活图事实从 session artifact 事件移入了项目 artifact store。最初的[工具迁移](../feature/2026-09-02-science-tool-receipts-slimming.zh.md)没有从项目 artifact store 重建这些事实，而是删除了模型可见的血缘、producer 引用与直接编辑摘要，减少了模型在运行或标注后能获得的信息。另外，`annotate_artifact` 在写入前通过当前 session projection 检查策展调用是否复用。该检查既不覆盖项目的完整 annotation 历史，也没有与授权消费共用一个事务。

## 决定

项目 artifact store 在现有的 `BEGIN IMMEDIATE` annotation 写事务内消费模型策展授权。模型 annotation 必须提供 `sessionId`、`toolCallId` 与 `requestHeaderSeq`；这个精确三元组在项目全部 annotation 中只能出现一次。复用会以 `ANNOTATION_TOOL_CALL_REUSED` 失败，Science runtime 再将其映射为模型可见的类型化错误 `ARTIFACT_ANNOTATE_TOOL_CALL_REUSED`。数据库 schema 没有变化，因此 `SCHEMA_VERSION` 保持为 `2`。

同一写路径也强制执行 annotation 的归属规则。Capture 只能为一个 version 创建第一条 annotation。后续元数据变更必须来自模型策展或人工编辑。Capture 与 human 写入不能冒用模型授权字段。

`dsh-tool-science` 从 store 归属事实重建有界的模型可见收据，不把来源字段加回 session 事件：

- `run_python` 与 `run_r` 把显式基础版本描述为 `edited from <logicalName> v<N>`，把隐式延续描述为 `continues v<N>`。
- `annotate_artifact` 把 producer 描述为 `produced by run_python (turn N)` 或 `produced by run_r (turn N)`，内部 run 标识符仍然隐藏。
- PNG artifact 暴露从 `figure_state` 解码得到的 `editCount` 与最近的直接图表编辑。`stateHistoryLimit` 限制返回的编辑列表，但计数始终完整。

工具结果包含的全部事实继续通过现有 tool-result session 事件记录。`versionId`、`sha256`、`projectId`、annotation actor 与内部 run 标识符仍不会出现在模型可见文本中。

## 考虑过的替代方案

**把 producer 与血缘字段加回 `science/artifact-saved`**——不采用。Artifact store 已经归属这些持久事实，工具执行可在构造收据时解析它们。把这些事实复制到 session 事件会产生两个权威来源。

**保留缩减后的收据**——不采用。缺少血缘、producer 上下文与编辑摘要是模型可见回归，不是可选的呈现细节。

**保留 runtime 的 projection 扫描并增加更多分支**——不采用。写入前的读取无法在并发调用下提供恰好一次消费，也不如权威 store 事务可靠地覆盖完整项目历史。

## 影响

Annotation 输入现在是判别联合类型：模型写入必须提供完整授权三元组，capture 与 human 写入则不接受它。Store 与 runtime 测试覆盖成功消费、跨版本及已取代 annotation 的复用、capture 归属，以及 runtime 的类型化错误映射。

列出 artifact 的工具现在会解析对应 `VersionRecord`；PNG 清单还会读取并解码 `figure_state`。配置的历史限制同时限制直接编辑明细，因此收据大小可预期。单元测试覆盖显式与隐式血缘、producer 文案、非 PNG 行为、编辑截断，以及不暴露内部标识符。三个模型可见收据形式也由 keyless Science 快照固定。
