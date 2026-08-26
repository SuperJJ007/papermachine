# Agent Note: Science artifact viewer panel

Status: implemented

[English](2026-08-18-science-artifact-viewer-panel.md) | 中文

本记录中的「消息」子视图及其导航已由 [Science artifact 溯源与私有 Review](2026-08-26-science-artifact-provenance-review.zh.md) 取代。Artifact 工作台、开放标签页、工具栏和其余溯源位置决策仍然有效。

## Problem

Science Details 条目此前渲染为一个常驻仪表盘：始终可见的环境概览、有序的运行列表、带版本导览条的图库/详情切换、header 触发的灯箱——外加一个独立的宽屏 `conversation.view` 标签页（`science.provenance`），承载四部分的溯源信息（代码、执行日志、对话轮次、环境）。打开 Details 意味着要先浏览一个状态页才能到达任意一个图表；到达溯源意味着要离开 Details 列，进入一个完整的中间列标签页，而返回另一个图表则要经由图库。面板中没有任何东西建模"我现在打开的这些 artifact"，因此同时处理两个图表版本没有一个持久的落脚点。

## Decision

Science Details 条目（`ui-science` 的 `conversation.details.view`，id 为 `science`）现在是一个 artifact viewer，而非仪表盘。顶部标签栏为每个已打开的 logical chart 持有一个标签页；点击一条会话记录中的 `save_chart` 行会打开或激活该图表的标签页，并定位到该行所指的确切版本。活跃标签页的内容视图在被分派的内容之上显示一条面板内工具栏（标题、一个跨该图表所有持久化版本的 `‹ vN ›` 版本步进器，以及溯源/下载/放大/关闭标签页控件）——如今只有一个图像渲染器，按图表持久化附件的媒体类型分派，因此后续的非图像 artifact 阶段只需新增一个分支，无需改动标签栏或工具栏。没有任何标签页打开时，viewer 显示其落地视图：每个 logical chart 最新版本组成的图库（打开其中一个即打开其标签页），以及展示在下方的最新 Outcome。

溯源是一个面板内下钻，而非一个独立的注册项：工具栏的"溯源"控件把活跃标签页的 `view` 切换为 `'provenance'`，渲染一条面包屑（`<图表标题> › 溯源`），下方是四个一次只显示一个的子标签页——代码、执行日志、消息、环境。`ScienceArtifactProvenance.tsx` 携带与 `ScienceProvenanceView.tsx` 相同的解析逻辑（通过 `toolCallId` 从运行的工具调用参数中取得代码、执行日志文本加投影中持久化的字节数/截断标记、以 JSON 形式展示环境版本并带已被取代版本的回退），把"对话"改名为"消息"，并保持它是一段摘要加一次跳转，而非消息重放。原先的 `conversation.view` 注册（`science.provenance`，随当前会话 `agentPreset` 跨越 Science 边界而动态注册/销毁）连同 `ScienceProvenanceView.tsx` 一并删除；本包中不再有按会话门控的动态注册。

原仪表盘的环境概览与运行列表被彻底移除——不会以任何形式的常驻小节重新出现在任何地方。环境相关的事实只存在于溯源下钻的"环境"子标签页中，作用域是某一个 artifact 的运行，行为与溯源视图一直以来的 JSON 加已被取代版本回退完全相同。没有任何会话级的"环境未生效"替代提示，因为该提示专属于已删除的概览小节，而一个没有任何 artifact 打开的会话也没有什么可供下钻；早于该概览存在的两条提示（缺失投影支持、未绑定）与它无关，保持不变。Outcome 小节迁移到落地视图，而非获得一个伪标签页，因为——与图表不同——它没有需要导览的版本历史或溯源信息。

选择状态存储（`selection-store.ts`）现在是一个开放标签页模型：一个有序的 `openArtifacts` 列表（每个 logical chart 一条，每条携带该标签页当前展示的版本）、`activeChartId`、一个 `view`（`'content' | 'provenance'`）与一个 `provenanceSubTab`（并非按标签页各自持有——切换到另一个标签页总会回到 `'content'`；子标签页的选择是一个跨标签页保留的偏好），以及 `lightboxOpen`。一个标签页所展示的版本从不单独成第二个字段：它总是从 `openArtifacts` 中匹配的条目读取。每个 action（`openTab`、`activateTab`、`closeTab`、`setTabVersion`、`setView`、`setProvenanceSubTab`、`setLightboxOpen`）都维持同一个不变式——`activeChartId` 为 `null` 当且仅当 `openArtifacts` 为空，否则它指向 `openArtifacts` 中的一条——该不变式直接在 `selection-store.client.spec.ts` 中得到证明，并（通过一个引用该证明的非空断言）被依赖，以使 viewer 自身的渲染代码不必携带一个死的防御性分支。该存储不做 `localStorage` 持久化（这一点在本次重设计前后保持不变）：在同一次页面加载内，已打开的标签页与当前视图能在 Details 列关闭再重新打开、或会话切换再切回之间保持不变，依靠的是框架自身按 (句柄, 会话) 划分的存储缓存，与 `ui-layout` 自身的"切换会话时强制关闭"行为无关——但无法跨越一次页面刷新。

`ScienceArtifactHeaderActions.tsx` 以及按键 `science` 分派的 `conversation.details.header.actions` 注册被删除：原先的两个控件（溯源、放大）如今都位于条目自己的工具栏中，那是条目自身的正文内容，而非外壳共享的 header 行。`DetailsPanel` 自己的 header 仍只显示条目级别的外观（标题、关闭）；工具栏这一层属于每个 artifact 的外观，位于面板正文之内。

有一处 ui-conversation 的改动是必须的：消息子标签页的跳转到对话记录动作需要与 `ConvViewOwnerProps.inspectCall` 给 `conversation.view` 条目相同的一次性 inspect-并展示交接机制，但 `DetailsViewOwnerProps`（`conversation.details.view` 条目的宿主份额）此前不携带任何内容。`DetailsViewOwnerProps` 新增一个必需的 `inspectCall: (callId: CallId) => void`；`DetailsPanel.tsx` 从它已经为 header-actions 分派持有的同一个 `store: chatStore` 份额中，把它提供给被路由的条目，写法与 `ConversationSession.tsx` 提供给 `conversation.view` 条目的完全一致（`actions.setInspect({ callId }); actions.setView('trajectory')`）——两个宿主向各自的座位种类提供同一种写法，而非其中一个导入另一个。由于该字段是必需的（而非可选——一项始终被提供的能力不应把一个假设性的 undefined 情形带入消费它的组件），每一个既有的手工构造的 `conversation.details.view` props 对象也都需要它：`ui-conversation` 中 `ToolDetailsView` 自己的测试夹具，以及 `ui-tool` 中每一个直接渲染 `ToolDetailsView` 的卡片测试（`diff-card`、`read-card`、`search-card`、`terminal-card`、`web-card`）都获得了一个空操作的 `inspectCall`。

## Alternatives considered

**把溯源保留为一个独立的 `conversation.view` 标签页。** 已拒绝：本次重设计的任务是一个可从工具栏进入的面板内下钻，匹配一个带标签的 artifact viewer，而非再造一个宽屏表面；它所需要的按会话门控的动态注册（仅在 Science 会话时存在，因为标签页的列表成员关系是框架不会过滤的静态台账）给同一条目内的下钻带来了完全不需要的机制。

**把 `DetailsViewOwnerProps.inspectCall` 设为可选，以避免波及 `ui-tool` 的测试。** 已拒绝：该能力由唯一真正的宿主（`DetailsPanel`）无条件地为每个条目提供，因此可选类型只会把一个防御性的 undefined 检查推入 `ScienceArtifactProvenance`，而这种情形在生产环境中根本不会发生——"在带类型的同进程边界处信任接口"这条规则在这里指向另一个方向。波及范围是七个测试文件各增加一行空操作 prop，而不是设计上的代价。

**在下钻旁边保留一条常驻的会话级环境概览。** 已拒绝：它正是本次重设计任务点名要移除的表面，而在两处重复同一份事实（一条常驻概览加一个按 artifact 的下钻）会制造出两处需要保持同步的地方。

**给 Outcome 小节在标签栏中安排自己的伪标签页。** 已拒绝：标签栏唯一的职责是"已打开的 artifact，每个 logical chart 一个，各自可独立关闭并在版本间步进"——Outcome 没有版本历史，也没有可供导览的溯源，不适配这个模型，而一个伪标签页会需要在每处假定标签页指向某个图表的真实代码里做特殊处理。落地视图的一个小节不需要额外的外观开销，而会话记录中 `publish_outcome` 行本身仍是定位某个具体版本的首选方式。

**让步进器按钮的 `onClick` 在 `prev`/`next` 为 undefined 时自行判断是否触发。** 一旦 `disabled` 已经阻止了激活，这条路径就被拒绝：处理函数内部的运行时判断是覆盖率门禁会正确标记出的不可达分支——修复方式不是关闭该判断所依赖的 `disabled` 状态，而是彻底省略该处理函数（`onClick={prev === undefined ? undefined : () => {...}}`），使剩下的每个分支都对应一次真实点击。

**在 web e2e 场景中用一次真实的 Chromium 下载事件来验证工具栏的下载控件。** 本次改动中已拒绝：无头模式下的下载处理会带来与它所能证明的额外价值不成比例的沙箱/CI 脆弱性，而 jsdom 单元测试（锚点的 `href`/`download`/`click`、两种文件名分支、被吞掉的拒绝路径）已经精确覆盖了这些内容。e2e 场景点击该控件并断言没有页面错误。

## Consequences

面板每屏需要理解的内容更少了（一个 artifact 的工具栏与内容，或一个下钻小节，从不会同时展现全部）——代价是不打开某个图表的溯源就再也看不到环境/运行信息了；这是可以接受的，因为这两类事实在没有 artifact 可关联时本就不具可操作性。标签栏与按标签页的版本步进器是新的持久状态，用户可能因此在一个长会话中打开多个图表标签页而失去追踪；目前还没有"关闭全部标签页"的功能，这与真实浏览器标签栏的行为一致，但与旧的单一选择模型不同——后者永远不会以同样的方式累积。内容分派的媒体类型 `switch` 正是本次重设计被要求为非 PNG artifact 留出的唯一接缝；该阶段落地时，标签栏、工具栏或存储都不需要再改动。`DetailsViewOwnerProps.inspectCall` 如今是每一个 `conversation.details.view` 条目契约的一部分，而不只是 Science 的；未来的条目将免费获得同样的跳转到对话记录能力。

本笔记的 Decision 一节取代了[Science artifacts — versioned figures carrying their provenance](2026-08-18-science-artifacts.zh.md)（同一功能线中的一篇已实现笔记）中"The artifact panel — Details column"与"The provenance view — conversation view tab"两节——该笔记这两节的正文现已直接陈述本次重设计的结果（版本导览条、header-actions 溯源/放大控件、按会话门控的 `conversation.view` 标签页——这两节最初提议、后被本次重设计取代的设计）。该笔记中 Host 端的投影关联与包清单相关决策不受影响，保持现行有效。
