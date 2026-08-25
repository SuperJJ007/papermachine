# Agent Note: Science 工作台 UI 收敛

Status: implemented

[English](2026-08-23-science-workbench-ui-convergence.md) | 中文

## Problem

Science artifact 可以通过会话 Details 操作进入，但外围产品仍把对话当作主要工作区。项目文件与结论没有稳定入口，模型辅助编辑在 artifact viewer 内使用第二个指令输入框，而工程用途的 Trajectory 是对话视图标签环里唯一的事件级记录。这些分裂造成导航重复，也让选中的图表元素离开用户的主请求上下文。

下文的 artifact-view mode 与 session-wide Trace placement 已被[Artifact 对象状态与逐轮因果](2026-08-25-artifact-object-state-and-turn-local-causality.zh.md)取代。文件/结论入口、composer ownership、shell palette、toggle placement 与直接编辑决策仍然有效。

## Decision

仅在当前为 Science Session 时，Web 外壳才在会话浏览器上方展示相互独立的 Science 文件与结论入口。设置固定在侧栏底部。文件打开 artifact 舞台；结论打开仅展示 Outcome 的独立路径。完整的三栏 Science 工作台即使在应用偏好为深色时也使用浅色文档配色：`AppFrame.module.css` 的 `.frame[data-science-session]` 规则会重置 `design-platform.css` 中浅色与深色取值不同的每一个 alias/specific token，一项覆盖率测试会解析这两份样式表，一旦新增的差异 token 在这里没有对应的浅色重置就会失败。非 Science Session 不会出现任何 Science 目的地、Trace 标签、composer accessory、kernel dock，也不会出现 `session` 模式下欢迎页的文件 action——该 action 读取当前（可能仍为空白的）Session 自身的 `agentPreset`，与其余每一处 Science 表面所依据的信号相同，而不是在还没有任何 Session 开始时对任意 preset 都显示。

桌面应用把 Science 强制设为产品默认值（其 overlay 设置 `agent-presets` 的默认值并禁用 `ui-agent-preset`），因此上面这套通用 Web 的 Session 门控放置在那里没有什么可区分的对象：用户打开桌面应用会直接落在工作区选择页面上，此时还没有选中任何工作区、也没有任何 Session 存在，而文件 toggle 此刻就必须在最右上角可见——这正是 ui-conversation 的 `conversation.page.utilities` slot 已经无条件占据的那个角落，因为该 slot 的所有者 `ConversationRoot` 以 session-maybe 方式挂载，无论 Session 处于什么状态都会渲染这个 slot。`ui-science` 的 Host 半侧校验一个 `toggleScope` Config 字段（`session` 是默认值，通用 Web 部署保持不变；或 `global`），并把解析结果作为一个 `globalThis` 启动值发布在每个插件包之前（`webserver/index-inject`，仿照 `dsh-client-ui-theme` 自身的启动值注入方式——这是把经校验的 Host Config 值带过 Host/浏览器进程边界的唯一现成机制，因为 client-modules 的启动图（`window.__DSH_BOOT__`）不携带任何逐插件的 config）。浏览器半侧在自己的 `apply()` 中同步读取一次这个启动值：`global` 只注册唯一一个无条件的 `conversation.page.utilities` action（`ScienceGlobalToggle`），完全跳过 session-header 的注册，因此该 toggle 只有一个所有者，并在此后每一种 Session 状态下都保持可见；`session` 则保留上文描述的交接方式不变。桌面应用的 overlay（`apps/desktop/src/runtime-overlay.ts`）会为 `ui-science` 这一行设置 `toggleScope: global`。

Science Details 条目继续作为 [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.zh.md) 定义的权威 artifact 舞台。文件页按 artifact 身份只投影一个最新版本卡片，不重复 Outcome；Outcome 保持独立 Details 目的地。已打开的 artifact 使用单行横向滚动标签栏。活跃 viewer 把标题与下载/放大/关闭控件放在第一行，把预览/差异/溯源与确切版本步进器放在第二行；选择历史版本会显示其在版本序列中的位置，并把正文切回预览。差异使用确切 `parent` 引用，通过会话作用域加载器与共享 `DiffBlock` 支持文本附件，并在父版本缺失、格式不支持、内容相同或加载失败时明确报告，绝不替换为 latest。溯源包含代码、执行日志、消息、审阅与环境；在 `science-session` 投影结构化记录之前，审阅保持明确空态。在 `session` 模式下，页面级文件开关位于 Session header 右对齐的 utility 组中；在 `global` 模式下，该开关位于每个页面的最右上角。Vega-Lite 元素行继续把人工样式选择与模型选择分开，raster 区域复用同一备注加 `+`/`−` 暂存路径。每一项选择与备注草稿都绑定确切 artifact id 和版本；切换标签页或版本会重新挂载预览，Host 在把一条持久 `science-edit` 用户消息加入队列前校验完整的有序 target 集合。

Vega-Lite 直接样式控件保留在舞台中，并在不请求模型的情况下提交一个 human-edit 版本。artifact 内嵌的指令输入框和发送操作不存在，因此模型辅助 artifact 修改只有一个 composer 和一条可见请求路径。

仅限 Science 的对话标签环包含一个从已加载真实 Session node 与客户端安全 Science 投影生成的用户 Trace 视图。每一轮是一个意图组，汇总运行尝试、失败、运行耗时、artifact 增量、委派与杂项工具；标题只由结构化运行和 artifact 字段决定。每个任务组至多展示一个 agent 结论，取该轮最后一条非空 assistant 文本事件；折叠卡片只包含任务组标题、状态、artifact 增量 chip 与一行截断结论，Trace 不展示中间 assistant 叙述。用户消息、结构化选择与直接人工编辑位于中轴的用户侧，agent 任务组位于另一侧，可滚动 Trace 按实时 composer 高度预留底部空间。artifact 溯源保留生成轮次中仅规范化空白的完整用户请求与完整 agent 结论；显式 `call:` 与 `turn:` 按钮分别打开 Trajectory 和语义 Trace，`artifact:` 操作则打开确切 artifact 舞台。持久内核的语言、epoch 和生命周期状态也在主 composer 下方的一个固定读数中出现。

对话服务拥有按视图划分的 Session 可见性注册表与已挂载视图打开器。一个注册的 `ViewVisibilitySource` 携带自己的失效通知（`subscribe`），与其按会话判定的 `visible` 谓词并列；对话服务的视图环除了自身的 slot 台账之外，还会订阅每一个已注册的来源——因此当某个可见性答案因台账本身察觉不到的原因发生变化（会话列表更新、投影落定）时，标签页仍会重新列出。Science 正是以这种方式注册 Trace 可见性：每当会话列表变化，就为列表中每个 Session 重新建立一次 `science` 投影订阅，因此普通对话不会出现 Science 标签，标签会在某个 Session 的 preset 或投影满足条件的那一刻出现，而溯源仍能在确切的 `turn:` 锚点打开 Trace。target chip 通过 Science locale 取文案，不内嵌英文，并展示每个 target 的原始备注文本（绝不做 JSON 转义）。下载始终解析当前所选的持久化源版本；确定性的 PNG/PDF 导出不属于本决策，也不保留占位控件。

## Alternatives considered

**保留 artifact 舞台中的第二个 composer。** 已拒绝：两条发送路径会把同一请求分裂到 artifact 局部状态与对话历史中，而且无法表达一条指令作用于多个 artifact 的目标。

**每个选中 target 发送一条消息。** 已拒绝：用户指令作用于整个选择集合；独立准入允许部分接受，也会丢失模型需要协调这些编辑的要求。

**仅把工程 Trajectory 账本作为 trace。** 已拒绝：它的原始事件检查与计时控件服务于调试。紧凑语义投影支持用户阅读因果关系，同时保留直达工程账本的路径。

**在 artifact 舞台重复显示内核状态。** 已拒绝：生命周期状态属于整个会话而非某个 artifact，两份副本会违反单一权威位置规则。

**为 raster 区域另设一套暂存路径，而不是复用共享的备注加 add 控件。** 已拒绝：区域与 spec path 都是同一套 Host 准入以同样方式校验的确切版本 target，另设第二套 UI 模式除了多一套测试、多一个二者互相漂移的机会之外没有任何收益。

**为 Trace 可见性轮询会话列表与逐 Session 投影，而不是用一个 `ViewVisibilitySource` 订阅。** 已拒绝：轮询要么把周期设得足够短、白白浪费周期，要么设得足够长、读到陈旧数据；注册来源自身的 `subscribe` 在空闲时零开销，只在其答案真的可能变化时才触发。

**手工挑选 Science 浅色覆盖要重置哪些 alias token，而不是从 `design-platform.css` 计算出差异集合。** 已拒绝：手工列表正是造成最初那个缺口的机制——后续加入调色板的 token 没有任何理由也同步进入一份人工维护的覆盖列表，而计算出的覆盖率测试会在缺失的那一刻立即失败。

**在浏览器中探测桌面这一 composition（构建目标、打包进去的 flag，或诸如 `navigator.userAgent` 之类不来自经校验 Host Config 的运行时探测/window 全局量）。** 已拒绝，属于环境探测：同一份已构建的客户端 bundle 服务于每一种 composition，因此放置方式必须来自组装该 composition 的 overlay 所设置的一个明确、经校验的 Config 字段，而不是让浏览器自行推断自己运行在哪个应用里。

**把 `toggleScope`经由 `ui-science` 设置卡片已经绑定的 `science-runtime` settings 命名空间（`ctx.settingsScope`）传递。** 已拒绝：该命名空间是一个运行时绑定关切（Conda 前缀），具有异步、响应式、可能由用户编辑的语义——对于一个需要在插件 apply 时同步就绪的固定部署组装事实而言是错误的契约，把一个无关的 UI 放置字段塞进去也会模糊该命名空间本应承担的唯一职责。

**为 client-modules 启动线路（`WebBootEntry`/`window.__DSH_BOOT__`）新增 `config`，让每个浏览器插件的 `apply(ctx, config)` 都能直接收到经校验的 Host config。** 已拒绝，不成比例：如今没有任何包需要这种通用能力，而这项改动会触及共享的线路 schema、Host 扫描器，以及每一个浏览器插件的 apply 签名，只为满足一个包里一个布尔量级的需求。`webserver/index-inject` 启动全局量——`dsh-client-ui-theme` 已经用它来传递这种一次性的 Host 到浏览器值——不触碰任何共享机制就解决了这个问题。

## Consequences

文件与结论解析为不同的 Details 目的地，文件页不再重复 Outcome。`AppFrame` 仍是 Details 列的唯一所有者，并在列宽求解器无法保留中心栏最小宽度时自动收起；Artifact 实现不新增 Drawer 或浮层系统。跨 artifact 选择在用户编写一条指令时保留，但只存在于浏览器本地，并且只在准入成功后清空。多目标消息扩大了持久 `science-edit` source 和模型可见文本，而每个 target 的确切版本准入与 `edit_of` 祖先规则不变。Trace 有意保持为线性语义投影：DAG 与 kernel epoch 分隔线留在工程检查中，委派只作为意图组内的一条折叠行，而不是独立泳道。

聚焦后端测试固定带备注 target 的有序文本与全有或全无校验。客户端组合测试固定仅限 Science 的目的地、accessory、kernel 与 Trace 可见性，以及双向元素与区域暂存、跨 artifact/版本的备注隔离，以及暂存后编辑备注会触达存储；keyless Science 场景通过真实可运行配置固定组装后的多目标消息。`ui-layout` 自己的覆盖率测试会扫描 `design-platform.css` 与 `AppFrame.module.css` 以验证浅色 token 重置，`ui-conversation` 中的一项编排测试固定了 `ViewVisibilitySource` 独立于 slot 台账失效的行为。

`ui-science` 自身的测试固定了两种 `toggleScope` composition：其 Host 半侧发布经解析的启动全局量（默认值与 `global`）并随自身 fiber 一起释放，其浏览器半侧的启动全局量读取器在值缺失或格式不正确时回退为 `session`，以及该插件在 `global` 模式下只注册那唯一一个 `conversation.page.utilities` 所有者（不含 session-header 条目），或在 `session` 模式下保持原有的一对注册不变。`apps/desktop` 的 runtime-overlay 测试固定了渲染出的 patch id 中 `ui-science` 这一行携带 `toggleScope: global`。这是一次纯粹的客户端组合与 Host config 改动，没有任何模型或会话记录可见输出发生变化，因此没有 keyless 快照需要更新。
