# Agent Note：从 store 生产者事实恢复确切的 Science artifact 溯源

Status: implemented

[English](2026-09-02-science-artifact-provenance-restoration.md) | 中文

## 问题

[项目 artifact store schema v2 迁移](../architecture/2026-09-01-project-artifact-store-schema-v2.zh.md)让 store 成为每个版本生产者身份的权威。后续的[客户端读路径迁移](../architecture/2026-09-01-science-artifact-raw-byte-reads.zh.md)从 Session artifact 投影中移除了生产者字段，但 `sessions.scienceVersions` 只公开了显示元数据。因此溯源下钻失去了「代码」「执行日志」「消息」「环境」页面，只保留内容来源与生成时间，尽管 store 仍持有确切的生产者 Session、run、工具调用、请求头与 turn。

根据版本附近的 turn 或 step 重建生产者并不成立。人工编辑与导入不一定有 run，同一个 turn 可能有多次调用，而项目库中的版本也可能来自投影尚未加载的另一个 Session。

## 决定

**`ScienceVersionSummary` 携带一个必需的 `producer` 对象，直接复制已经通过鉴权的 store `VersionRecord`。** 该对象包含生产者 `sessionId` 及其可选的 `runId`、`toolCallId`、`requestHeaderSeq` 和 `turn`；`sessionTitle` 只是从生产者 Session 尽力 fold 出来的显示文字，绝不参与身份判断或鉴权。`sessions.scienceVersions` 仍让每个请求的版本经过 `authorizedScienceArtifact`，并省略未获授权的 id，因此扩充已获授权的结果不会引入第二套可见性规则，也不会泄漏被省略版本是否存在。

**浏览器只在已获授权的摘要到达后连接确切身份。** 当前 Session 中的生产者先按 `runId` 匹配 `science.runs`；没有 run 条目时，才用 `toolCallId` 作为确切回退；同一个 call id 寻址对话工具调用投影。不存在按 turn/step 邻近程度猜测的回退。生产者属于另一个 Session 时，每个溯源页面都显示其标题或 id，并且不尝试连接当前 Session 的 run 或 call。通过 library 打开的 artifact 也先经同一个 Session 作用域 loader 请求版本摘要，再渲染溯源。

**四个溯源页面各自承担边界明确的职责。** 「代码」显示生产运行的源码；「执行日志」显示该运行的 stdout 与 stderr；「消息」只显示生产调用的 Question 与 Result 两行，并提供前往确切调用与对话位置的动作；「环境」显示与该 run 关联的当前投影绑定。投影保留的绑定不再匹配 run 记录的环境 revision 时，页面标明不匹配，而不是把当前绑定当作历史事实。缺少 run、call、日志、消息、绑定，或者生产者属于另一个 Session 时，受影响页面会明确显示不可用状态。

所选溯源页面继续保存在既有的 Session 作用域 `provenanceSubTab` store 字段中。下钻本身仍是瞬态状态：重新打开 Details 列时回到 artifact 内容，但下次进入溯源时仍选择上次的页面。

## 考虑过的方案

**把生产者字段恢复到 `ScienceClientArtifactVersion` 与 Session 事件**——否决。store 已经持有生产者身份；再复制进 artifact 投影会重新引入 store 迁移刚刚消除的双权威漂移。已获授权的版本摘要读取就是既有的客户端 store 元数据路径。

**用版本的 turn 与 step 匹配 run 或工具调用来推断生产者**——否决。这些坐标不是唯一的生产者身份，合法的人工编辑与导入版本也可能没有这些坐标；它们同样无法指明另一个 Session 中的生产者。

**为跨 Session 版本自动加载生产者 Session**——否决。溯源渲染不会因此获得授权，也不应恢复另一个 Session。当前响应只能显示已经附在获授权 store 记录上的生产者标签；导航或投影加载需要独立、用户可见的 Session 能力。

## 影响

Host API、schema 与 handler 通过 `sessions.scienceVersions` 公开 store 生产者事实；runtime 原样传输扩充后的摘要。`ui-science` 把这些事实连接到当前 Session 的 run 与对话投影，为实时 artifact 和 library 打开的 artifact 恢复四页溯源组件，并为部分事实缺失与跨 Session 情况保留明确的不可用状态。没有新增 Session 事件或模型可见输入。

Host model 测试证明已获授权的摘要携带生产者事实，而未获授权的版本不携带任何内容。组件测试覆盖每个页面、确切调用导航、事实缺失、环境不匹配与跨 Session 呈现。构建后的 Web Science outcome 场景会在真实浏览器中执行恢复后的下钻。
