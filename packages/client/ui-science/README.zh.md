# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

浏览器端的 Science 执行单元格、轮末产物组、语义泳道、artifact viewer、Science 设置卡片和文件 toggle。本包只消费冻结的工具调用/结果数据与客户端安全的 `science` 会话投影；它不创建 Science 事实，也不改变模型可见内容。泳道与 artifact viewer 共享同一投影和一个本包内部选择状态存储。

## 语义泳道

泳道以 `trajectory.view` id `swimlane` 贡献，仅在会话的 preset 或已解析投影为 `science` 时可见。它排在内置「详细」之前，因此 Science 会话进入「轨迹」时默认显示泳道，其他会话仍只显示详细账本。每个生成轮只有一张卡，严格限制为三行：截断的用户要求、结构化的运行/失败摘要，以及不换行的精确 artifact 版本小标签。泳道不复制 Assistant 散文或 Agent 结语。运行摘要在「详细」中打开对应调用；artifact 小标签在共享查看器中打开精确版本。

可见性通过 `ctx.trajectorySubviews.registerVisibility('swimlane', source)` 注册。会话列表变化时，该 source 会重新绑定投影订阅，因此 preset 指派、Session 创建、投影解析、插件卸载与热更新都会直接使轨迹内层切换器失效并重算。

## 轮末产物

Science artifact 展示元数据会聚合到权威 turn 数据中。Assistant 回复之后，一个轮末组为每个逻辑 artifact 渲染一张卡，并仅保留该轮产生的最高版本。卡片显示缩略图或媒体类型磁贴、文件名与版本；激活卡片会在 Science Details 中打开该精确版本。`annotate_artifact` 仍是折叠的过程单元格，不在调用处渲染 artifact 卡，因此文件在会话记录中只出现一次。产物数 ≤ 6 时全部显示；≥ 7 时先显 5 个，再加一个「+N 更多」按钮原地展开其余产物。标题计数始终是本轮总数，不是可见数；展开态是组件本地视图状态，刷新后恢复默认折叠。

## 执行单元格

`run_python` 与 `run_r` 呈现八种状态（`ScienceExecutionRow.tsx`、`run-output.ts`），全部由 `tool-science` 的 `formatRunResult` 产出的既有工具结果文本与联结的 `science` 会话投影运行条目（按 `toolCallId` 匹配）驱动——绝不发明新的 Host 事实。运行捕获的表格/图表产物一律不在行内渲染 chip；每个产物只在轮末组出现一次（见上文）。

1. **运行中**——一行随秒数更新的 `mm:ss` 状态，以及一个跳转到整轮级 Stop 的按钮（复用注入的 `cancel`，即已有的全局中断控制）；由于目前没有 stdout 增量通道，行内只降级显示静态「正在执行…」摘要——实时 tail 是后续工作，本行不为此新开通道。
2. **成功·短输出**（保留行数 ≤ 8）——完整 stdout 原样内联显示，不折叠。
3. **成功·长输出**（> 8 行）——折叠按钮标注行数与保留字节数；完整文本仅在展开后挂载。
4. **成功·输出截断**——折叠按钮改为标注保留末尾的字节数，并附一条提示：输出超出上限、完整输出可从溯源打开恢复。
5. **失败**（除内核死亡外的任意非成功状态）——以错误色内联显示 stderr 末尾两行的摘要；第二个折叠按钮展开完整 stderr。
6. **内核在运行中途退出**（`failureCode: 'KERNEL_DIED'`）——独立的琥珀色状态，标注已退出的内核序号与下次运行将启动的序号，并提供「查看退出原因」操作，复用该行既有的 `inspect`（与其他状态相同的调用级轨迹跳转——目前尚无更细的 kernel-state 事件专属跳转）。

以下两种情况会降级为八态改造前的纯折叠单元格（折叠代码 + 已完成输出，点击展开）：本次调用在 science 投影中没有对应的运行条目，或展平后的文本不携带 `formatRunResult` 的固定分节标记（手搭建的测试夹具，或真正的工具级异常/轮次中断）——两者都选择降级，而不是发明既有事实不支持的状态。展开状态与运行中的实时计时器都只是组件本地的前端状态，既不记入日志，也不投影到 provider 请求。

**延后事项**：把内存中的 DataFrame 结果提升为独立的产物式行（画板中的「df — …」chip）留待 Notebook/Compute 数据地基阶段；内核退出态的「重启并重跑」操作延后，以保证重跑始终经由模型/对话发起，而不是绕过轨迹一致性的直连客户端控件。

其余一切 Tool 调用（`get_science_state`、`read`、`grep`、`todo_write` 等）仍通过 `ui-tool` 的通用 `ToolRow` 兜底分发，收敛为「单行单元格 + 展开」交互——相邻时现在还会归入 `ui-conversation` 的通用工具组——本包对此未注册，也不重复实现。

## 对话流过程细节 chrome

`registerTranscriptDetailVisibility`（`ui-conversation` 的 `IConversation`）会为满足泳道资格的会话隐藏对话流中的上下文注入展开行，以及每轮的 `用时`/TTFT/吞吐标签（`createTranscriptDetailVisibilitySource`，与泳道自身可见性来源同一套响应式判定逻辑，取反）。两者都仍可从持久日志重建——上下文行经由 Trajectory 详细子视图，计时数字经由 composer dock 的全会话统计条，本抑制机制不影响后者。`ui-conversation` 自身无条件渲染两者，仅通过其 `processDetailVisible` chat-node Hook 咨询已注册的来源，因此不携带任何 Science 专属代码；本包目前是唯一的注册方。

## Outcome 行

已完成的 `publish_outcome` 默认只显示单行版本摘要。展开单元格后才显示不可变的标题、Markdown 摘要和运行/图表/消息证据；精确图表引用仍通过当前客户端安全的 `science` 投影解析。展开状态仅存在于前端。

## 设置卡片

该卡片以固定的 `science-runtime` 命名空间——`@deepseek-ai/dsh-science-runtime/with-settings` 注册的命名空间，而非某个包名或产品 id——为键注册进 `settings.plugin.item`，因此只要 Host 服务了该命名空间它就会出现，否则不留任何痕迹，也无需任何导航条目或 Host 侧改动。它通过 `ctx.settingsScope` 绑定该命名空间，只编辑 `['science', 'pythonPrefix']` 与 `['science', 'rPrefix']`（分节根部本身就是配置档案映射，以固定的 `science` 配置档案 id 寻址，而非包一层 `profiles` 字段），加上用于显式移除覆盖动作的 `unsetPath(['science'])`；没有任何代码路径会写入分节根部。两个字段都是 `role('secret')`，其存储值从不出现在任何 settings 响应里——卡片从 `SettingsScopeSnapshot.secrets` 获知逐字段的存在状态，并且从不把已存储的路径回显进输入框。留空的替换输入是空操作。卡片的状态行会把运行中 Host 的实际绑定状态与当前存储值对照后上报——`effective`（配置档案已绑定，且 Host 已经读取过）、`pendingRestart`（存储值与绑定值不一致，无论方向：Host 尚未读取的新保存值，或 Host 仍绑定着、已从存储中移除的旧值），或 `notConfigured`——读取自 `SettingsScopeSnapshot.effective`（Host 的 `applies: 'restart'` Science Runtime 入口在自身注册时读到的值，冻结至下一次 Host 启动）与 `.value`（当前存储的分节）的对照，而非某个客户端本地的标志位，因此页面刷新后这一判断保持不变。该卡片拥有自己的暂存与 revision 设栅，而不是把**插件配置**分区的卡片外观或暂存表单模型作为值导入——bundle 纯净度门禁禁止这样做。它的外观构建在 `@deepseek-ai/dsh-client-ui-primitives` 的共享原子之上——两个前缀字段用 `Input`，Configured/Not configured 徽章用 `Pill`，保存/放弃修改/移除覆盖都用 `Button`——而不是未加样式的原生元素，因此卡片与应用自身的控件保持一致；只有卡片容器的边框/圆角/背景，以及默认收起的 header/chevron 布局——没有任何原生组件提供这两者——才是本包自己的 CSS。收起时，可访问性树里只有 header（名称、描述与展开开关）——每个字段、提示与操作按钮都只在展开后才会渲染，与每个兄弟卡片的行为及可访问名称的措辞保持一致。

## 选择状态存储

artifact viewer 与会话记录行共享同一个本包私有的、按会话划分的存储（`selection-store.ts`），保存开放标签页模型：一个有序的 `openArtifacts` 列表（每个 logical chart 一条，每条携带该标签页当前展示的持久化版本）、`activeArtifactId`、活跃标签页的 `view`（`'content' | 'provenance'`）、下钻上一次展示的 `provenanceSubTab`，以及一个 `lightboxOpen` 标记。活跃标签页所展示的版本本身并不单独成字段——它总是从 `openArtifacts` 中匹配的条目读取，因此一个标签页所展示的版本只有一处记录。`view` 与 `provenanceSubTab` 是单一字段，而非按标签页各自持有：切换到另一个标签页总会回到 `'content'`，而上一次选中的溯源子标签页作为一个跨标签页保留的偏好设置。该存储是 Science 专属的查看状态，因此由 ui-science 直接持有，而不是加进 `@deepseek-ai/dsh-client-ui-conversation` 的 `ChatStoreState`——后者由该包持有，服务于其自身骨架分派的状态。每个插件 fiber 创建一个句柄，作为 `store:` 注册座位传给需要它的每一个条目，因此让会话记录行与 viewer 就同一实时实例达成一致的是框架自身的"句柄 × 会话"缓存，而不是它们之间的一次值导入；正是这同一个按会话划分的缓存，让一个会话已打开的标签页在 Details 列关闭再重新打开之间保持不变，与 `@deepseek-ai/dsh-client-ui-layout` 自身的"切换会话时强制关闭"行为无关。

## Artifact viewer（Details 条目）

viewer 以 id `science` 注册进 `conversation.details.view`，标签来自 `science` 命名空间的已注册文案。它渲染的数据来自 chart/Outcome 行读取的同一个 `science` Session 投影，加上上面的选择状态存储；写路径调用 Host 所有的 `scienceEdits` Remote，而不在浏览器里改写投影状态：

- **标签栏** — 每个已打开的 artifact（logical chart）一个标签页，各自可独立关闭；点击一条会话记录中的图表行会打开或激活该图表的标签页，并定位到该行所指的确切版本。没有任何标签页打开时，viewer 显示其落地视图，而非一条空标签栏。
- **工具栏** — 面向活跃标签页的内容视图：artifact 的标题与逻辑名、一个版本步进器（‹ v*n* ›，在两侧相邻的持久化版本间切换），以及溯源/下载/关闭标签页控件，加上仅在图像 artifact 上出现的放大控件（文本附件没有可放大的位图）。下载通过同一个会话作用域加载器解析持久化字节（图像用 `loadImage`，文本用 `loadText`），并经由一个临时的 URI 锚点触发浏览器保存——图像是 `loadImage` 给出的 `data:` URI，文本则是基于 `loadText` 已解码字符串构建的 `data:` URI；放大打开共享灯箱（第二个、由存储驱动的 `ImageLightbox` 实例，因为工具栏与内容图片自身的私有点击展开状态是兄弟关系，而非其祖先）。
- **内容**（`ArtifactContent.tsx`） — 按 artifact 的持久化 project-store 媒体类型分派：`image/png` 经本包的 `ScienceArtifactImage` 渲染；文本媒体类型通过 `loadText` 取得并解码字节后再次分派——`text/csv` 渲染为一个可排序、可滚动的表格（`ArtifactTable.tsx`），`application/json` 渲染为 `JsonTree`（来自 `@deepseek-ai/dsh-client-ui-primitives`），`application/vnd.vega-lite+json` 通过内联打包的 `vega-embed` 渲染器以 Vega-Lite 模式、关闭浏览器操作项并采用 SVG 渲染，`text/markdown` 经由 `MarkdownText` 渲染，`text/plain` 渲染为预格式化文本。面向用户的内容不显示内部运行 id 与原始字节数。无法解析的 Vega-Lite JSON 回退为原始预格式化文本；已解析但被渲染器拒绝的文档回退为 `JsonTree`，因此畸形 spec 不会使 viewer 崩溃。这个分派正是后续新增受支持媒体类型要扩展的接缝：新增一个分支即可，无需改动标签栏或工具栏。CSV 表格最多渲染 `MAX_ARTIFACT_TABLE_ROWS`（500）行，非 CSV 文本在尝试 JSON 解析或 `<pre>` 渲染之前会被限制到 `MAX_ARTIFACT_TEXT_CHARACTERS`（100,000）个字符——二者都是固定的呈现层上限（`format.ts`），不是 `Config` 字段，与准入该文件的部署自身 `textLimits` 字节上限无关；被截断的渲染会显示一条"仅显示前 N 项"的提示。
- **编辑选择** — Vega-Lite artifact 在每一层组合结构（`layer`/`hconcat`/`vconcat`/`concat` 成员与 `facet`/`repeat` 的子 `spec`）上暴露结构化的 `mark`/`encoding.*` 元素行。点击行名称或图表会选中人工样式 target；渲染后的 SVG 同时会为可唯一识别的顶层 title、mark group、X/Y axis 或唯一 legend 绘制外框，对嵌套或有歧义的 path 则回退为整张 SVG 外框。行内独立的 `+` 控件则把确切 target 及其可选备注暂存到主 composer，composer chip 的变化会立即同步行内 `+`/`−` 状态。raster 的可选归一化拖拽层会画出一个人工样式区域，一旦区域画出，就提供同样的备注加 `+`/`−` 控件——单纯画出区域不会暂存任何东西，只有这个显式控件才会——因此区域 target 与结构化 target 经由同一条路径抵达 composer，产出同样的 `edit.regionTarget` chip。每一份备注草稿都绑定到其确切的 artifact 身份（artifact id 加版本）：切换标签页或步进版本都会重新挂载内容子树，因此某个 artifact/版本上还未暂存的备注草稿绝不会预填进另一个共享同一 spec path 或区域坐标的字段。在某个 target 已经暂存之后再编辑其备注，会立即更新已暂存的选择（而不必等到下一次点击 `+`），因此 composer chip 与最终面向模型的指令始终携带最新文本。发送一条指令时，浏览器通过 `remote.scienceEdits.submit` 提交有序 `{ targets, instruction }` 请求。Host 在排入一条 `user/message` 前校验每个确切当前版本和每条可选 target 备注，并在拒绝前指明是哪个字段出了问题——共享指令本身，还是某个 target 自己的备注；任一缺失、媒体类型不匹配、格式错误或版本陈旧的 target 会拒绝整条请求，并标明其列表位置。artifact viewer 不含第二个指令输入框或发送操作。
- **直接样式编辑** — 选择 Vega-Lite `mark` 或 `encoding.*` target 还会打开基于不可变工作副本的样式面板。面板只暴露颜色、字号与 encoding axis/legend 标题文本；每次修改都会重新渲染实时 SVG 预览，数据变换仍由 agent 完成。定稿时通过 `remote.scienceEdits.commitStyleEdit` 发送完整 JSON spec；成功后选择返回的下一个 version，其详情明确标记直接编辑并指名确切 parent。Host 的 stale/media/JSON/admission 拒绝会保持可见，且不改变所选 version。UI 子集用于塑造工作流，并不声称能对任意 Vega-Lite JSON 建立安全不变量。
- **Review 备注** — 内容查看页列出 logical artifact 的私有备注，并针对当前确切版本接受新备注。添加与删除走专用 Remote 和 Session 投影；Host 强制执行 8,192 字符上限。备注只属于用户、绝不进入模型上下文，溯源下钻也不会复制它们。
- **溯源下钻** — 距内容视图一次工具栏点击之遥（见下文）；一条面包屑可返回内容视图。
- **落地视图** — 在没有标签页打开时显示每个 logical artifact 的最新版本图库；打开任一项即创建其标签页。

在第一条 Science 事件之前，viewer 显示一个未绑定状态；当会话摘要携带 preset 时一并显示所选 preset。缺失投影支持、附件不可用，以及指向投影已无法解析的 artifact/版本的失效标签页，各自渲染不同文案。

**设计说明——原仪表盘中的事实去了哪里。** 常驻的环境概览与运行列表不会重新出现为会话级面板小节。环境事实只存在于溯源下钻的「环境」子标签页，作用域是某一个 artifact 的运行。Outcome 保留在折叠的 `publish_outcome` 会话单元格中，不再有独立 Details 目的地或落地视图小节。

Artifact 缩略图与内容通过本包自己的会话作用域加载器（`science-attachment-loader.ts`）解析，而非会话界面拥有的附件加载器。两者都调用 `ISession.readScienceArtifact(versionId)`：Host 在读取字节之前，会对照该 Session 的严格 Science fold 鉴权确切 store 版本。`loadImage` 把返回字节转换为 `data:` URI；`loadText` 以严格 UTF-8 解码。两者都不使用 `Map`，也不持有 `URL.createObjectURL` 句柄，因此 Session 释放时无需回收，也没有第二套缓存。

**CSV 表格（`ArtifactTable.tsx`）是本包内部组件，而非 `dsh-client-ui-primitives` 的导出。** 设计阶段对 `packages/client` 的一次全仓库搜索没有发现任何表格组件，也没有会需要它的第二个消费方；`JsonTree`/`MarkdownText` 之所以原样复用 `ui-primitives` 里的实现，是因为它们已经为其他消费方存在于那里。解析逻辑（`csv.ts`）是手写的、类 RFC4180 解析器（带引号字段、字段内嵌逗号/换行、双引号转义），而非一个依赖：这是对自动捕获或模型标注文件的只读预览，从不涉及任意不受信任的上传，"可配置性不能作为提供不受支持……公开操作集的理由"（`packages/AGENTS.md`）对一个投机性共享基础组件同样适用。未来出现真正的第二个消费方，才是把两者提升进 `ui-primitives` 的触发条件，而不是这一个。

## 文件 toggle
<a id="files-toggle"></a>

toggle 渲染在何处由本包 Host `Config` 中的 `toggleScope` 决定：`session`（默认）或 `global`，经 `z.union(['session', 'global'])` 校验。`session` 对应通用 Web 的呈现门控：该 action 注册进 `conversation.session.header.utilities`，除非当前 Session summary 的 `agentPreset` 指向内置 `science` preset，否则什么都不渲染——Standard 或自定义的非 Science Session 不会显示该 action——并额外注册一个 `conversation.page.utilities` 条目（`ScienceHeroAction`），在当前 Session 为空白且已被指派为 `science` preset 时覆盖欢迎页（该 Session 一旦开始，header 就会接管这个 action）。`global` 则改为注册唯一一个无条件的 `conversation.page.utilities` action（`ScienceGlobalToggle`），完全跳过 session-header 的注册，因此该 toggle 在应用全局可见——在选中任何工作区之前、在任何 Session 存在之前都可见，并在此后每一种 Session 状态下都保持是它唯一的所有者；没有任何 Session 状态会门控它。激活其中任意一个注册都会调用宿主提供的 toggle 回调（`session` 模式下是 `toggleDetailsView('science')`，`global` 模式下是 `toggleDetails`），因此同一个控件既打开 Details 列也关闭它；它不会打开自己的面板，也不持有任何面板状态。

Host 半侧在每个插件包之前（`webserver/index-inject`，仿照 `@deepseek-ai/dsh-client-ui-theme` 自身的启动值注入方式）把解析出的 `toggleScope` 发布为一个 `globalThis` 启动值——浏览器半侧在自己的 `apply()` 中同步读取一次；缺失或格式不正确的值会回退为 `session`。

## 溯源下钻

从 artifact viewer 的工具栏进入（不是一个独立的 `conversation.view` 标签页，也不是一个按键分派的 `conversation.details.header.actions` 条目）：一条面包屑（`<图表标题> › 溯源`），其根节点点击后返回内容视图，下方是针对活跃标签页已解析的 chart/run 的四个子标签页：

1. **代码** — 来源运行的 `code` 参数，通过该运行的 `toolCallId` 从会话快照中解析得到，并展示持久化的 `codeSha256` 作为锚点（与环境指纹不同，这里展示完整值——它是对同一次调用已经逐字复述过的源代码文本求的摘要，而不是 Host 基础设施事实）。
2. **执行日志** — 来自同一调用已完成结果的 stdout/stderr 文本，并在旁展示投影中持久化的字节数与截断标记，作为权威度量——即使会话记录尚未加载也可见。
3. **消息** — 展示生成轮次之前最近的用户文本和该轮最后一段 assistant 文本，二者在视觉上各限制为三行；另有两个不同动作，分别在对话中居中生成该产物的 assistant 节点，以及在详细 Trajectory 中检查该 run。下钻绝不重放对话。若某个 version 由另一 Session 产出，则仅以文本展示来源 Session 标题，不提供两个动作；跨 Session 导航延后处理。
4. **环境** — 当投影仍保留该确切版本时，以 JSON 形式展示该环境版本（配置档案、版本号、状态、时间戳，以及逐语言的 capability/版本/指纹预览与包清单）；若该版本已被取代（投影只保留最新版本），则单独报告这一状态，并展示该运行自身的指纹预览作为仍然保留的事实。

解析 chart/run 组合（并在其中任一方不再可解析时报告不可用）是 artifact viewer 的职责，不属于本下钻组件——它总是针对一个已经解析好的组合渲染。

## 工作台外壳

除了上面的文件 toggle 与 Details 条目之外，本包还通过 ui-conversation 与 ui-sidebar 声明的附加 slot 组装工作台的其余部分，每一处都按当前 Session 的 `agentPreset` 门控（若无 Session，则按一个已经指派为 `science` preset 的空白 Session 门控）——除 `global` 模式下的文件 toggle 之外，没有任何 Science 表面会出现在另一个 preset 之下，或在完全没有 Session 时出现：

- **`sidebar.destinations`**（`ScienceDestinations`） — 在当前 Science Session 的侧边栏中贡献一个文件行；它打开 `science` Details 条目，没有当前 Science Session 时不渲染。
- **`conversation.page.utilities`** — 文件 toggle 在 `session` 模式下的欢迎页交接注册（`ScienceHeroAction`），或在 `global` 模式下的唯一注册（`ScienceGlobalToggle`）；见[文件 toggle](#files-toggle)。
- **`conversation.input.accessory`**（`ScienceComposerChips`） — 主 composer 上方以可移除 chip 形式展示的暂存 target，读取本包私有的、按会话划分的 `ScienceComposerSelections` 存储——artifact viewer 的 `+`/`−` 控件写入的正是同一个存储。一个注册的 `registerSubmissionHandler` 会在有任意 target 暂存时抢先认领一次普通发送，调用 `remote.scienceEdits.submit` 提交暂存的 target 与作为指令的 composer 文本，并只在 Host 接受后才清空暂存的 target；携带普通图片的提交会在触达 Remote 之前就被拒绝。
- **`conversation.composer.dock`**（`ScienceKernelStatus`） — composer 下方展示的、来自 `science` 投影 `kernels` 列表的逐语言最新生命周期状态（`live`/`exited`/`interrupted`）；没有投影或没有存活内核时不渲染任何内容。
- **`details.files`**（`ScienceEmptyDetails`） — 没有当前 Session 时 Details 列的占位内容，说明选择一个 Session 后这里会显示其文件，并通过宿主提供的 `closeDetails` 关闭该列。

## 组装

请在 `@deepseek-ai/dsh-client-ui-tool`、`@deepseek-ai/dsh-client-ui-attachment`、`@deepseek-ai/dsh-client-ui-conversation`（header action 与 Details 条目所在的座位，以及 artifact viewer 溯源下钻复用的 Details 座位 `inspectCall` 宿主回调）、客户端 locale/runtime 包、`@deepseek-ai/dsh-client-ui-settings`（`ctx.settingsScope`），以及会暴露 `science` 会话投影的 Host 组合之后加载本浏览器插件。已发布的 Web bundle 会以有意留空的配置档案映射挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，因此在有人填写 Python/R Conda 前缀并重启 Host 之前，卡片会以未配置的 `science` 配置档案出现；CLI 与 headless bundle 保留各自显式的 Runtime 组合，不显示该卡片。本包的 Host 行（`main` 入口）订阅 `webserver/index-inject` 时并未声明 `webServer` 注入（仿照 `@deepseek-ai/dsh-client-ui-theme` 自身的 Host 半侧）；没有 webserver 行的组合只是永远不会收集到这次订阅。桌面应用的 overlay（`apps/desktop/src/runtime-overlay.ts`）会为这一行设置 `toggleScope: global`，因为它自己的 overlay 已经把 Science 强制设为产品默认值。

## 模型体验

无，因为本包不组装 provider request；artifact 查看器可以请求 Host 的 `scienceEdits` Remote（`@deepseek-ai/dsh-tool-science` 的 "Viewer edit message" 一节）校验已提交的选择，并把模型读取的结构化精确版本 user message 排入队列。

#### KV Cache 影响

没有；本包既不组装也不发送 provider request。

## 已知限制与暂缓事项

- **运行中行的执行摘要是静态的，不是实时 tail** — Runtime 与浏览器之间尚无 stdout 增量通道，因此运行中的 `run_python`/`run_r` 行显示固定的「正在执行…」，而不是画板设想的最新 stdout 行预览，直到该通道存在为止。
- **内核退出行的「查看退出原因」跳转到失败调用，而非其自身的 `kernel-state` 事件** — 该行复用与其他状态相同的调用级轨迹 `inspect`；跳转到精确的 `science/kernel-state` 事实是后续导航工作。
- **不支持内存 DataFrame 提升** — 一次只产生内存值（画板中的「df — …」行）的 `run_python`/`run_r` 结果，在 Notebook/Compute 数据地基阶段落地前，没有可提升的产物式 chip。
- **轮末产物依赖标签化 presentation 元数据** — 如果某个已完成 turn 的工具未发布 `science/artifact` presentation 值，即使独立投影稍后包含相关文件，该 turn 也没有产物组。
- **没有独立 artifact 缓存** — 会话附件继续使用会话界面拥有的加载器。Science 缩略图与内容通过 `ISession.readScienceArtifact` 上的无状态加载器解析；两条路径都不添加自己的持久化 Map 缓存。
- **仅一个固定配置档案、两个字段** — 卡片只编辑内置 `science` 配置档案的 `pythonPrefix`/`rPrefix`，因为内置 preset 是当前唯一的产品消费方；其他部署配置档案 id 仍是文件/配置层面的事，不由浏览器管理。
- **没有发现、探测或即时生效** — 卡片从不列出、探测或校验某个 Conda 环境，也没有文件系统选择器或即时生效控件；已存储的前缀只有到下一次 Host 重启才会生效，卡片的 `pendingRestart`/`effective` 状态会上报这一点，但无法缩短等待。
- **环境历史仅保留单一版本** — `science` 投影只保留最新的一次环境绑定，因此一旦绑定发生变化，溯源下钻"环境"子标签页就无法展示某个较旧图表运行时的确切版本；它会转而报告仍然保留的版本号与指纹预览。
- **已打开的标签页不做持久化保存** — 选择状态存储只存在于框架按 (句柄, 会话) 划分的缓存里，而非 `localStorage`：在同一次页面加载内，已打开的标签页与当前视图能在 Details 列关闭再重新打开、或会话切换再切回之间保持不变，但无法跨越一次页面刷新。
- **超过渲染上限的文本 artifact 无法在原地完整浏览** — `MAX_ARTIFACT_TABLE_ROWS`/`MAX_ARTIFACT_TEXT_CHARACTERS`（`format.ts`）会在整个内容进入 DOM 之前截断表格/文本渲染，因此表格排序与 JSON 解析都只作用于已显示的前缀，而被截断的 `.vl.json` 几乎必然无法重新解析，所以超限的 Vega-Lite artifact 显示为截断的原始文本而非图表；下载仍会取回完整的持久化字节。
- **没有 PNG/PDF 图表导出** — 一个已禁用的本地化 Export 控件明确呈现 C4 暂缓状态；Vega-Lite artifact 只在原地渲染为 SVG，确定性的位图/PDF 导出被推迟到某个没有浏览器渲染器的客户端确认支持 Science 图表之后再建（[决策记录](../../../.agents/notes/proposed/architecture/2026-08-22-science-spec-first-charts.zh.md)）。
- **不暴露任何结构化目标的 spec 无法添加 composer chip** — 目标发现沿 `layer`、`hconcat`/`vconcat`/`concat` 成员以及 `facet`/`repeat` 的子 `spec` 遍历 `mark`/`encoding.*`；一份不含这些结构的文档（或截断后不再可解析的文本）不提供结构选择，但只读渲染与下载仍然可用。
- **渲染出的图表没有文本替代** — 嵌入的 SVG 只携带 Vega 自身生成的标记，没有伴随的摘要或数据表替代形式；spec 的 JSON 源文本仍可通过下载取得。
- **外部 Vega-Lite 资源不会被解析** — viewer 向 `vega-embed` 传入受限 loader，其 `sanitize` 拒绝一切 HTTP(S) 与协议相对 URI；由于 `sanitize` 是 Vega 所有资源解析都会经过的唯一入口（`load` 自身的默认实现在发起请求前会先调用它，而图片标记的 `href`/`url` 则直接经它清理，根本不会调用 `load`），该限制同时覆盖远程 `data.url` 内容、图片标记与链接。依赖远程 `data.url` 的 spec 会降级为 JSON tree 并显示说明；引用远程 URI 的图片标记或链接则只是不会被解析，图表照常渲染，只是缺少那一部分。内联 `data.values` 仍可渲染。
- **Vega 渲染器主导了客户端包体积** — 打包 `vega-embed` 使 `lib/client.js` 达到约 2.0 MB（gzip 约 475 KB），并且只要本插件挂载就会静态加载，无论会话里有没有图表；改为在首个 Vega-Lite artifact 出现时再加载属于暂缓事项。
