# Agent Note: Science 工作台 UI 收敛

Status: implemented

[English](2026-08-23-science-workbench-ui-convergence.md) | 中文

## Problem

Science artifact 可以通过会话 Details 操作进入，但外围产品仍把对话当作主要工作区。项目文件与结论没有稳定入口，模型辅助编辑在 artifact viewer 内使用第二个指令输入框，而工程用途的 Trajectory 是对话视图标签环里唯一的事件级记录。这些分裂造成导航重复，也让选中的图表元素离开用户的主请求上下文。

## Decision

仅在当前为 Science Session 时，Web 外壳才在会话浏览器上方展示相互独立的 Science 文件与结论入口。设置固定在侧栏底部。文件打开 artifact 舞台；结论打开仅展示 Outcome 的独立路径。完整的三栏 Science 工作台即使在应用偏好为深色时也使用浅色文档配色：`AppFrame.module.css` 的 `.frame[data-science-session]` 规则会重置 `design-platform.css` 中浅色与深色取值不同的每一个 alias/specific token，一项覆盖率测试会解析这两份样式表，一旦新增的差异 token 在这里没有对应的浅色重置就会失败。非 Science Session 不会出现任何 Science 目的地、Trace 标签、composer accessory、kernel dock，也不会出现欢迎页的文件 action——欢迎页 action 读取当前（可能仍为空白的）Session 自身的 `agentPreset`，与其余每一处 Science 表面所依据的信号相同，而不是在还没有任何 Session 开始时对任意 preset 都显示。

Science Details 条目继续作为 [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.zh.md) 定义的权威 artifact 舞台，同时 `design/science-demo-ui` 的实际渲染是文件库卡片与 viewer 排布的视觉权威，但不替换产品的浅色配色。文件库只展示当前 Session 生成的 artifact：客户端安全的 Science 投影不携带上传附件数据，因此文件库没有上传文件分区。生成卡片显示真实媒体类型、版本、已知尺寸与字节数。打开的 artifact 使用标签页；每个 viewer 都有返回文件库的操作、标题、格式/版本/来源/状态信息栏、版本导航、溯源、下载、按媒体类型分派的内容，以及渲染后元素控件。页面级文件开关位于 Session header 右对齐的 utility 组中，排在 Session Log 之后，并公开激活状态。Vega-Lite 元素行把人工样式选择与模型选择分开：点击名称或图表会打开样式面板，行内独立的 `+` 控件则把确切路径及可选元素备注暂存到主 composer。raster 一旦画出一个区域，就通过完全相同的备注加 `+`/`−` 控件暂存，产出与结构化 target 同样的 `edit.regionTarget` chip。移除 composer chip 会立即恢复该行的 `+` 状态；在某个 target 已经暂存之后再编辑其备注，会立即更新已暂存的选择，而不必等到下一次点击 `+`，因此 chip 与最终面向模型的文本绝不会与输入框显示的内容不一致。每一份备注草稿都绑定到其确切的 artifact 身份（id 加版本）：内容子树会在每次切换标签页或步进版本时重新挂载，因此某个 artifact/版本上还未暂存的草稿绝不会预填进另一个共享同一 spec path 或区域坐标的字段。带 chip 的发送会形成一条持久 `science-edit` 用户消息，其中有一个有序 `targets` 数组；每个 target 都指明确切 artifact 版本，并可携带各自经过校验的备注。Host 在把任何内容加入队列前，先针对完整折叠的会话逐项校验，并在拒绝前指明是哪个字段出了问题——共享指令本身，还是某个 target 自己的备注；错误会指出失败项的位置。发送成功后清空所有 chip；普通图片附件不能与这种结构化编辑一起发送。

Vega-Lite 直接样式控件保留在舞台中，并在不请求模型的情况下提交一个 human-edit 版本。artifact 内嵌的指令输入框和发送操作不存在，因此模型辅助 artifact 修改只有一个 composer 和一条可见请求路径。

仅限 Science 的对话标签环包含一个从已加载真实 Session node 与客户端安全 Science 投影生成的用户 Trace 视图。每一轮是一个意图组，汇总运行尝试、失败、运行耗时、artifact 增量、委派与杂项工具；标题只由结构化运行和 artifact 字段决定。每个任务组至多展示一个 agent 结论，取该轮最后一条非空 assistant 文本事件；折叠卡片只包含任务组标题、状态、artifact 增量 chip 与一行截断结论，Trace 不展示中间 assistant 叙述。用户消息、结构化选择与直接人工编辑位于中轴的用户侧，agent 任务组位于另一侧，可滚动 Trace 按实时 composer 高度预留底部空间。artifact 溯源保留生成轮次中仅规范化空白的完整用户请求与完整 agent 结论；显式 `call:` 与 `turn:` 按钮分别打开 Trajectory 和语义 Trace，`artifact:` 操作则打开确切 artifact 舞台。持久内核的语言、epoch 和生命周期状态也在主 composer 下方的一个固定读数中出现。

对话服务拥有按视图划分的 Session 可见性注册表与已挂载视图打开器。一个注册的 `ViewVisibilitySource` 携带自己的失效通知（`subscribe`），与其按会话判定的 `visible` 谓词并列；对话服务的视图环除了自身的 slot 台账之外，还会订阅每一个已注册的来源——因此当某个可见性答案因台账本身察觉不到的原因发生变化（会话列表更新、投影落定）时，标签页仍会重新列出。Science 正是以这种方式注册 Trace 可见性：每当会话列表变化，就为列表中每个 Session 重新建立一次 `science` 投影订阅，因此普通对话不会出现 Science 标签，标签会在某个 Session 的 preset 或投影满足条件的那一刻出现，而溯源仍能在确切的 `turn:` 锚点打开 Trace。target chip 通过 Science locale 取文案，不内嵌英文，并展示每个 target 的原始备注文本（绝不做 JSON 转义）。导出实现不属于本决策；C4 提供实际操作前，artifact 工具栏保留一个已禁用的本地化占位按钮，通过 `aria-disabled`/`data-unavailable` 而非原生 `disabled` 属性保持其在 tab 顺序中可达。

## Alternatives considered

**保留 artifact 舞台中的第二个 composer。** 已拒绝：两条发送路径会把同一请求分裂到 artifact 局部状态与对话历史中，而且无法表达一条指令作用于多个 artifact 的目标。

**每个选中 target 发送一条消息。** 已拒绝：用户指令作用于整个选择集合；独立准入允许部分接受，也会丢失模型需要协调这些编辑的要求。

**仅把工程 Trajectory 账本作为 trace。** 已拒绝：它的原始事件检查与计时控件服务于调试。紧凑语义投影支持用户阅读因果关系，同时保留直达工程账本的路径。

**在 artifact 舞台重复显示内核状态。** 已拒绝：生命周期状态属于整个会话而非某个 artifact，两份副本会违反单一权威位置规则。

**为 raster 区域另设一套暂存路径，而不是复用共享的备注加 add 控件。** 已拒绝：区域与 spec path 都是同一套 Host 准入以同样方式校验的确切版本 target，另设第二套 UI 模式除了多一套测试、多一个二者互相漂移的机会之外没有任何收益。

**为 Trace 可见性轮询会话列表与逐 Session 投影，而不是用一个 `ViewVisibilitySource` 订阅。** 已拒绝：轮询要么把周期设得足够短、白白浪费周期，要么设得足够长、读到陈旧数据；注册来源自身的 `subscribe` 在空闲时零开销，只在其答案真的可能变化时才触发。

**手工挑选 Science 浅色覆盖要重置哪些 alias token，而不是从 `design-platform.css` 计算出差异集合。** 已拒绝：手工列表正是造成最初那个缺口的机制——后续加入调色板的 token 没有任何理由也同步进入一份人工维护的覆盖列表，而计算出的覆盖率测试会在缺失的那一刻立即失败。

## Consequences

文件与结论解析为不同的 Details 目的地；文件落地视图仍保留最新 Outcome 作为上下文，而结论目的地不包含 artifact 导航。`AppFrame` 会在完全没有当前 Session（真正的欢迎页）的那一刻关闭 Details 列，而一个正在创建中的空白 Session（id 已存在，只是尚无第一个 turn）会像以往一样让该列在这段过渡期间保持打开——这两种状态被分开跟踪，因此关闭只属于一次真正的 Session 切换或完全没有 Session，绝不属于二者之间的这段过渡。跨 artifact 选择在用户编写一条指令时保留，但只存在于浏览器本地，并且只在准入成功后清空。多目标消息扩大了持久 `science-edit` source 和模型可见文本，而每个 target 的确切版本准入与 `edit_of` 祖先规则不变。Trace 有意保持为线性语义投影：DAG 与 kernel epoch 分隔线留在工程检查中，委派只作为意图组内的一条折叠行，而不是独立泳道。

聚焦后端测试固定带备注 target 的有序文本与全有或全无校验。客户端组合测试固定仅限 Science 的目的地、accessory、kernel 与 Trace 可见性，以及双向元素与区域暂存、跨 artifact/版本的备注隔离，以及暂存后编辑备注会触达存储；keyless Science 场景通过真实可运行配置固定组装后的多目标消息。`ui-layout` 自己的覆盖率测试会扫描 `design-platform.css` 与 `AppFrame.module.css` 以验证浅色 token 重置，`ui-conversation` 中的一项编排测试固定了 `ViewVisibilitySource` 独立于 slot 台账失效的行为。
