# Agent Note：从 store 生产者事实恢复 Science 同轮中间稿折叠

Status: implemented

[English](2026-09-02-science-same-turn-draft-folding-restoration.md) | 中文

## 问题

[客户端原始字节迁移](../architecture/2026-09-01-science-artifact-raw-byte-reads.zh.md)从 `ScienceClientArtifactVersion` 移除了内容来源、生产者 Session 与生产者 turn。它也删除了 `intermediate-versions.ts`，artifact 版本步进器不再跳过同轮中间稿。当时 store 仍保留这些事实，但浏览器没有获授权的逐版本读路径。

恢复后的溯源读取现在通过 `sessions.scienceVersions` 返回确切的 store 生产者。因此折叠可以恢复，而不必把生产者字段复制回 Session artifact 投影，也不必从附近的对话节点重建这些字段。

## 决定

**版本摘要批量读取是完整的折叠输入。** 对活跃 artifact 的每个版本，`ScienceDetailsView` 从该确切版本已获授权的摘要读取 `contentOrigin`、`producer.sessionId` 与 `producer.turn`。摘要尚未加载，或者生产者没有 turn 时，该版本保持可遍历。当前查看 Session 的 id 与 Session artifact 以前携带的 turn 字段都不能替代这些事实。

**只有同一个 artifact 中严格更晚、且生产者 Session 与 turn 均相同的版本才折叠较早版本。** `human-edit` 永远豁免。`run-auto` 与 `import` 携带生产者 turn 时遵循同一身份规则。`foldIntermediateVersions` 只返回版本号；它绝不修改投影、store 或持久字节。

**工具栏只从默认遍历顺序中移除被折叠版本。** direct link 打开一份被折叠版本时，当前版本仍留在遍历顺序中，相邻控件可以离开它。中间稿切换按钮不会恢复；[显式的移除决策](../simplification/2026-09-01-remove-intermediate-toggle.zh.md)仍然有效。

## 考虑过的方案

**在 `ScienceClientArtifactVersion` 上恢复 `contentOrigin`、`producerSessionId` 与 `turn`**——否决。store 持有生产者身份，而已获授权的版本摘要 RPC 已经为溯源和折叠传输所需的确切事实。

**使用当前查看 Session 的 id 与投影版本的 turn**——否决。一个 project artifact 可以包含来自多个 Session 的版本，而 turn 计数器只能在一个生产 Session 内比较。缺少摘要事实时必须让版本保持可见，不能做猜测。

**删除被折叠版本或者让它无法到达**——否决。折叠只影响呈现。持久版本仍可由既有的精确版本链接寻址，包括 Science Process 视图；直接打开一份被折叠版本后，该版本也仍留在自己的步进器遍历顺序中。

## 影响

`intermediate-versions.ts` 再次持有同一 artifact 内的纯规则，`ScienceDetailsView` 持有已获授权摘要到折叠事实的映射以及工具栏过滤。包 README 不再把 C2 列为缺失，并继续记录不存在中间稿切换按钮。

纯函数测试覆盖更晚的同轮版本、跨 Session 的 turn 号碰撞、人工编辑、缺失 turn 与任意输入顺序。Details view 测试证明 store 摘要接线与当前版本豁免。构建后的 Web fixture 在一个生产者 turn 中创建两个版本，证明默认步进器跳过早期版本，再通过 Process direct link 打开该版本，并经步进器离开。无密钥可访问性记录钉住装配后的三版本场景。
