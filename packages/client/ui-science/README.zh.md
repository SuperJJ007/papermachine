# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

浏览器端的 Science 执行单元格、轮末产物组、过程视图、artifact viewer、Science 设置卡片和文件 toggle。本包只消费冻结的工具调用/结果数据与客户端安全的 `science` 会话投影；它不创建 Science 事实，也不改变模型可见内容。过程视图与 artifact viewer 共享同一投影和本包内部的产物选择状态存储。

直接修改行在自适应宽度的标签列中显示完整的本地化元素名。多子图按编号分组，整图行在前；单子图不显示分组标题。分组行以外的元素引用仅在 id 带 `axes[n].` 前缀时附加本地化子图号。产物和文件标签页位于 `conversation.details.header.tabs`，页面选择器位于头部第一行，两者读取同一个 selection store。

## 过程视图

运行只通过已加载对话中的来源调用归属请求；缺失来源调用的运行单独显示在未归属历史区域,提供一个数量,不计入任何请求的步骤、失败或耗时。加载更早的对话页后重新计算归属。产物按 store 自己记录的该版本 `createdAt`(经 `sessions.scienceVersions` 读取,由 `useScienceVersionSummaries` 按 artifact 批量取——见 [Artifact viewer](#artifact-viewer-details-entry))落在某个 turn 自己的计时窗口内来归属请求——这与一次直接人工改图早就在用的规则相同,现在所有内容来源共享同一条规则,因为客户端安全的产物投影已经不再携带可供查找的来源调用。一个产物的 `createdAt` 从不会归属失败(它落回推断出的最近一个 turn,当它落在每个已声明窗口之外时),因此本包的过程/轨迹模型不存在"未归属产物"这个状态;一个步骤自己从不列出产物 chip,只有 turn 层的分组才有——此前基于来源调用的逐步骤归属,连同它需要的字段一起没了。

「过程（Process）」以 `trajectory.view` id `process` 贡献，仅在会话的 preset 或已解析投影为 `science` 时可见。它排在「详细」之前，因此 Science 会话进入「轨迹」时默认显示过程，其他会话仍只有详细账本。单左轨右侧通栏排列 agent 与人工改图卡，人工改图保留用户图标与蓝色左边框。折叠的轮卡片有四个结构化行：截断的用户要求、通栏有序步骤条、右对齐的统计与展开控件，以及每个产物在本轮最终版本的小标签。要求之外不附加任何自由文本说明。长步骤条和产物标签行在卡片内换行。步骤条最多渲染 120 次调用并提示总数；展开清单仍然完整。

点击卡片要求或背景可展开、收起步骤；原生展开按钮支持 Enter 与 Space，并报告展开状态。步骤色块展开并高亮对应行。独立控件及整个输入输出详情区域保留自身的点击、滚动与文本选择。行标题在原位展开所代表的全部调用，包括合并资料组的每个成员，绝不选择「详细」。精确版本的产物按钮打开共享文件查看器，不改变当前轨迹子视图。轮次展开、调用展开与高亮在子视图切换后保留，但不落盘。

每行显示 assistant 步号、种类标记、结构化标题、结果及产出的产物版本。运行还显示有长度上限的原始代码预览；合并的资料组列出各成员标题。本地详情显示已记录的代码、其他输入参数、工具结果文本，以及记录格式支持时分列的 stdout/stderr，并展示可用的内核、环境修订、失败及输出保留信息。尚未记录的结果与空结果明确区分。代码、参数及输出分别采用产物文本显示上限，提供截断提示并独立滚动；日志不变。非文本结果显示数量与类型，不展示原始附件数据。过程不复制 assistant 散文，也不推断代码意图。

标题取自工具名、经校验的 JSON 参数字段和 Science 事件。文件标题省略目录，标注与历史发布标题截断到四十个字符。显式输入详情可展示日志中的原始路径。运行状态和时长以 run 记录为准，其他失败来自工具结果的错误标志。同轮内连续未失败的资料调用合并，并保留各成员。运行、标注、历史发布、委派和失败分别成行。步骤统计包含所有有调用的不同 assistant 步号，包括合并行内部的步号；纯回答步骤除外，并行调用共享步号。会话统计对产物去重并累加轮次墙钟时长；缺少结束时间时回退到已完成运行的时长之和。至少一分钟的时长显示为整数分钟与秒。

内核启动、退出和中断事实显示为时间线标记，不单独渲染环境卡。终态 epoch 同时提供启动和结束标记；退出原因说明变量何时清空。标记优先放在包含其时间戳的轮次之前（含起止时刻），否则放在之后开始的第一轮之前，再否则放在最后一轮之后。没有结束时间的轮次包含其开始时刻及之后的全部时间戳。当前环境可用时，启动标记显示其 profile 名。

可见性通过 `ctx.trajectorySubviews.registerVisibility('process', source)` 注册。会话列表变化时，该 source 会重新绑定投影订阅，因此 preset 指派、Session 创建、投影解析、插件卸载与热更新都会直接使轨迹内层切换器失效并重算。

标注标题需要逻辑名称和标题；仅在调用提供数字版本号时显示版本。

步骤条与清单标记共用两种状态色和中性形状：柔和绿色运行方块、红色失败方块、浅中性的资料查看／委派／其他方块、中性空心标注方块，以及中性实心发布圆点。结果使用辅助文字色的纯文本，失败为红色；蓝色只标识选中行与人工操作。

## 轮末产物

Science 跟随应用主题。产物图片在缩略预览与查看器中保持固定浅色画布，不反色或变暗。

Science artifact 展示元数据会聚合到权威 turn 数据中。Assistant 回复之后，一个轮末组为每个逻辑 artifact 渲染一张卡，并仅保留该轮产生的最高版本。卡片显示缩略图或媒体类型磁贴、一个展示名（本轮所保留版本自身的既定标题；标题为空时用逻辑名）与版本；激活卡片会在 Science Details 中打开该精确版本。`annotate_artifact` 仍是折叠的过程单元格，不在调用处渲染 artifact 卡，因此文件在会话记录中只出现一次。产物数 ≤ 6 时全部显示；≥ 7 时先显 5 个，再加一个「+N 更多」按钮原地展开其余产物。标题计数始终是本轮总数，不是可见数；展开态是组件本地视图状态，刷新后恢复默认折叠。

## 执行单元格

`run_python` 与 `run_r` 呈现运行中、已结束和内核不可用等状态（`ScienceExecutionRow.tsx`、`run-output.ts`），全部由 `tool-science` 的 `formatRunResult` 产出的既有工具结果文本与联结的 `science` 会话投影运行条目（按 `toolCallId` 匹配）驱动——绝不发明新的 Host 事实。运行捕获的表格/图表产物一律不在行内渲染 chip；每个产物只在轮末组出现一次（见上文）。

1. **运行中**——一行随秒数更新的 `mm:ss` 状态，以及一个跳转到整轮级 Stop 的按钮（复用注入的 `cancel`，即已有的全局中断控制）；由于目前没有 stdout 增量通道，行内只降级显示静态「正在执行…」摘要——实时 tail 是后续工作，本行不为此新开通道。
2. **成功·非空输出**——stdout 默认折叠，按钮标注行数与保留字节数；展开后显示全部保留行。
3. **成功·输出截断**——折叠按钮改为标注保留末尾的字节数，并附一条提示：输出超出上限、完整输出可从溯源打开恢复。
4. **失败**（除内核死亡外的任意非成功状态）——以错误色内联显示 stderr 末尾两行的摘要；第二个折叠按钮展开完整 stderr。
5. **内核在运行中途退出**（`failureCode: 'KERNEL_DIED'`）——独立的琥珀色状态，标注已退出的内核序号与下次运行将启动的序号，并提供「查看退出原因」操作，复用该行既有的 `inspect`（与其他状态相同的调用级轨迹跳转——目前尚无更细的 kernel-state 事件专属跳转）。

以下两种情况会降级为纯折叠单元格（折叠代码 + 已完成输出，点击展开）：本次调用在 science 投影中没有对应的运行条目，或展平后的文本不携带 `formatRunResult` 的固定分节标记（手搭建的测试夹具，或真正的工具级异常/轮次中断）——两者都选择降级，而不是发明既有事实不支持的状态。展开状态与运行中的实时计时器都只是组件本地的前端状态，既不记入日志，也不投影到 provider 请求。

**延后事项**：把内存中的 DataFrame 结果提升为独立的产物式行（画板中的「df — …」chip）留待 Notebook/Compute 数据地基阶段；内核退出态的「重启并重跑」操作延后，以保证重跑始终经由模型/对话发起，而不是绕过轨迹一致性的直连客户端控件。

其余一切 Tool 调用（`get_science_state`、`read`、`grep`、`todo_write` 等）仍通过 `ui-tool` 的通用 `ToolRow` 兜底分发，收敛为「单行单元格 + 展开」交互——相邻时现在还会归入 `ui-conversation` 的通用工具组——本包对此未注册，也不重复实现。

## 对话流过程细节 chrome

插件通过 `conversationEvents.registerUserInput` 将 `science-edit` 注册为用户输入。聊天与 Detailed Trajectory 显示原始指令和有序、带版本的引用；生成的传输文本不进入用户气泡。过程视图 使用日志中的 Turn 位置，因此引用消息在重新加载后仍然可见，也不会使后续请求错位。

`registerTranscriptDetailVisibility`（`ui-conversation` 的 `IConversation`）会为满足过程视图资格的会话隐藏对话流中的上下文注入展开行，以及每轮的 `用时`/TTFT/吞吐标签（`createTranscriptDetailVisibilitySource`，与过程视图自身可见性来源同一套响应式判定逻辑，取反）。两者都仍可从持久日志重建——上下文行经由 Trajectory 详细子视图，计时数字经由 composer dock 的全会话统计条，本抑制机制不影响后者。`ui-conversation` 自身无条件渲染两者，仅通过其 `processDetailVisible` chat-node Hook 咨询已注册的来源，因此不携带任何 Science 专属代码；本包目前是唯一的注册方。

## 已记录的 Outcome 行

已有会话中已完成的 `publish_outcome` 默认只显示单行版本摘要。展开单元格后才显示不可变的标题、Markdown 摘要和运行/图表/消息证据；精确图表引用仍通过当前客户端安全的 `science` 投影解析。展开状态仅存在于前端。Science 工具 Consumer 不为新调用提供发布工具。

## 设置卡片

该卡片以固定的 `science-runtime` 命名空间——`@deepseek-ai/dsh-science-runtime/with-settings` 注册的命名空间，而非某个包名或产品 id——为键注册进 `settings.plugin.item`，因此只要 Host 服务了该命名空间它就会出现，否则不留任何痕迹，也无需任何导航条目或 Host 侧改动。它通过 `ctx.settingsScope` 绑定该命名空间，只编辑 `['science', 'pythonPrefix']` 与 `['science', 'rPrefix']`（分节根部本身就是配置档案映射，以固定的 `science` 配置档案 id 寻址，而非包一层 `profiles` 字段），加上用于显式移除覆盖动作的 `unsetPath(['science'])`；没有任何代码路径会写入分节根部。两个字段都是 `role('secret')`，其存储值从不出现在任何 settings 响应里——卡片从 `SettingsScopeSnapshot.secrets` 获知逐字段的存在状态，并且从不把已存储的路径回显进输入框。留空的替换输入是空操作。卡片的状态行会把运行中 Host 的实际绑定状态与当前存储值对照后上报——`effective`（配置档案已绑定，且 Host 已经读取过）、`pendingRestart`（存储值与绑定值不一致，无论方向：Host 尚未读取的新保存值，或 Host 仍绑定着、已从存储中移除的旧值），或 `notConfigured`——读取自 `SettingsScopeSnapshot.effective`（Host 的 `applies: 'restart'` Science Runtime 入口在自身注册时读到的值，冻结至下一次 Host 启动）与 `.value`（当前存储的分节）的对照，而非某个客户端本地的标志位，因此页面刷新后这一判断保持不变。该卡片拥有自己的暂存与 revision 设栅，而不是把**插件配置**分区的卡片外观或暂存表单模型作为值导入——bundle 纯净度门禁禁止这样做。它的外观构建在 `@deepseek-ai/dsh-client-ui-primitives` 的共享原子之上——两个前缀字段用 `Input`，Configured/Not configured 徽章用 `Pill`，保存/放弃修改/移除覆盖都用 `Button`——而不是未加样式的原生元素，因此卡片与应用自身的控件保持一致；只有卡片容器的边框/圆角/背景，以及默认收起的 header/chevron 布局——没有任何原生组件提供这两者——才是本包自己的 CSS。收起时，可访问性树里只有 header（名称、描述与展开开关）——每个字段、提示与操作按钮都只在展开后才会渲染，与每个兄弟卡片的行为及可访问名称的措辞保持一致。

## 选择状态存储

artifact viewer 与会话记录行共享一个本包私有的按会话存储（`selection-store.ts`），其中 `openArtifacts` 是有序联合：`{ kind: 'artifact', artifactId, version }` 或 `{ kind: 'file', path }`。`activeTabId` 为 `artifact:<artifactId>`、`file:<path>`，或者在成果库主页处为 null；`libraryPage` 记住该主页显示成果还是项目文件。artifact 条目继续按 logical artifact 去重，并在唯一位置记录选中的持久版本。`view` 是共享 viewer 字段：激活文档总是回到 content。`provenanceSubTab` 仍声明在 store 的持久化状态里以保持形状稳定，但当前没有任何组件读写它——溯源下钻已经没有子标签页了(见[溯源下钻](#provenance-drill-in))。框架的「句柄 × 会话」缓存让该状态与会话记录行共享，并在 Details 列关闭再打开时继续存活。引擎以会话作用域的 localStorage 键持久化选择状态，包括已打开的标签页、成果库页与折叠分组，因此刷新浏览器后仍会恢复；`view` 与 `lightboxOpen` 被声明为瞬态字段（`defineStore` 的 `transient` 列表），始终来自 `init()`——标签页关闭时仍处于打开状态的灯箱或溯源下钻，不得在下次加载时重新盖在内容之上。

产物按产生它的对话分组，组可折叠，折叠状态随选择存储持久化。当前会话置顶，其他组按最新产物时间降序，排序只影响组内卡片。搜索过滤卡片并隐藏空组。组头显示会话标题、可见数量及最新相对时间，时间格式与侧边栏共享；网格卡片是一张有边框的整体——上半是通栏 1:1 缩略图（图片裁到左上角，非图片则居中显示文件类型磁贴），下半是脚注，显示标题与 `vN · 相对时间`，不再显示媒体类型文字。列表布局仍是 76px 缩略行，脚注文案与网格一致。`ProjectLibrary` 每次渲染只取一次 `Date.now()`，组头与每张卡片的脚注共用同一个值。

## Artifact viewer（Details 条目）
<a id="artifact-viewer-details-entry"></a>

文件预览按工作区路径挂载，并忽略挂载结束后到达的响应。查看器统一持有当前会话及跨会话 PNG 版本的工具栏灯箱。图表预览完成后不会重新启动防抖计时；参见[查看器生命周期决策](../../../.agents/notes/implemented/bug-fix/2026-08-31-science-viewer-lifecycle.zh.md)。

viewer 以 id `science`、`primary: true` 注册进 `conversation.details.view`——会话未显式选定某个配置项时,Details 列默认显示的就是这一项(ui-conversation 的 `DetailsPanel.tsx resolveActiveDetailsView`;整个注册表最多一个条目可以声明 `primary`,第二个在注册时抛错)。它的 keyed `conversation.details.header.actions` 条目把一级「成果」与「项目文件」页签放进 Details header，同时由通用 shell 保留关闭控件。它渲染的数据来自 chart/Outcome 行读取的同一个 `science` Session 投影，加上上面的选择状态存储；写路径调用 Host 所有的 `scienceEdits` Remote，而不在浏览器里改写投影状态：

- **标签栏** — artifact tab 与 workspace file tab 共用同一条二级可关闭标签栏；没有打开文档时完全不渲染。成果库主页没有自己的文档 tab。点击任一一级页签会让活跃文档返回所选成果库页，但不关闭任何已打开 tab。点击会话记录 artifact 会打开其精确版本，工具栏返回键回到上次选择的成果库页，关闭最后一个文档也会自动回到那里。
- **工具栏** — 面向活跃标签页的内容视图：成果库返回键、一个版本步进器（‹ v*n* ›）、溯源/下载/另存为/关闭标签页控件，加上仅在图像 artifact 上出现的放大控件（文本附件没有可放大的位图）。步进器不再跳过任何版本地走完全部持久版本（见下方 C2 已知限制）。每个版本显示自己当前的标题（经由 `useScienceVersionSummaries`；D9——Files 面板与本工具栏读的是同一份 store 事实）。下载先对 `scienceArtifactUrl(sessionId, versionId)`（`@deepseek-ai/dsh-client-runtime` 的原始字节端点）做一次 HEAD 预检，在创建任何 anchor 之前就把 410 `missing_content`/409 `content_corrupt`/其他失败分类成可见文案，随后触发一次裸 `anchor.href = url; anchor.click()`，靠端点自己的 `Content-Disposition` 文件名——不经 base64、不经 `data:` URI、不由客户端算文件名。另存为打开一个内联命名表单，调用注入的 `saveArtifactAs`（`scienceEdits.saveArtifactAs`）；调用成功后把打开的标签页切到新成果。放大打开共享灯箱（第二个、由存储驱动的 `ImageLightbox` 实例，因为工具栏与内容图片自身的私有点击展开状态是兄弟关系，而非其祖先）。
- **内容**（`ArtifactContent.tsx`） — 按 artifact 当前的 project-store 媒体类型分派（经由与工具栏相同的 `useScienceVersionSummaries` 批量读取）：`image/png` 经本包的 `ScienceArtifactImage` 渲染，这是一个直接读 `scienceArtifactUrl` 的 `<img>`；文本媒体类型 `fetch()` 同一个 URL 后按媒体类型再次分派——`text/csv` 渲染为可排序、可滚动的表格（`ArtifactTable.tsx`），`application/json` 渲染为 `JsonTree`（来自 `@deepseek-ai/dsh-client-ui-primitives`），`text/markdown` 经由 `MarkdownText` 渲染，`text/plain` 渲染为预格式化文本；浏览器按响应的 `Content-Type` 自行解码（端点刻意不声明 charset——理由见原始字节读取的 Agent Note：在客户端猜测一个非 UTF-8 编码,比把决定权留给浏览器更糟）。面向用户的内容不显示内部运行 id 与原始字节数。JSON 与纯文本在渲染前应用 `MAX_ARTIFACT_TEXT_CHARACTERS`（100,000），CSV 表格最多渲染 `MAX_ARTIFACT_TABLE_ROWS`（500）行。这些固定的浏览器呈现上限（`format.ts`）不是 `Config` 字段，也不改变部署的持久化文件准入上限。
- **图表编辑**（`ScienceChartEditPanel.tsx`）— 已打开的 PNG 版本内容挂载时，`ArtifactContent.tsx` 的 `ChartEditSlot` 经 `loadChartState`（`sessions.scienceChartState`，走 `ISession.readScienceChartState`）取一次该版本的实时图表对象状态；读取结果非 `null` 才挂载面板——没有存下 figure state 的版本（导入或历史内容）或读取失败都不挂载任何东西。对 `chart` 可寻址的 `image/png` 版本，在 raster 内容下方挂一张无卡片、无折叠层级的紧凑常显表单，直接提供标题／副标题、x/y 轴标签、网格、字体族／字号与图例位置控件。这些控件生成封闭的 `set_title`、`set_subtitle`、`set_axis_label`、`toggle_grid`、`set_font` 与 `set_legend_position` 操作。字体字段通过简短固定候选表接受自由输入，不枚举已安装字体；字体不可用时显示本地化操作失败。每个可直接编辑行只能通过自身 `+`/`−` 操作添加精确引用，点击行或编辑控件都不改变引用状态。其余已抽取元素显示为可换行的引用行，展示完整名称与图中实际颜色，整行都可切换引用；annotation 只常显前六项，其余由一个数量控件展开。直接改动在组件本地态里累积为待存 `ScienceChartOp`——全程不经模型、不进 session log——并通过 Runtime 获得防抖预览；引用变化绝不请求预览。Save 经注入的 `applyChartOps`（`scienceEdits.applyChartOps`）提交待存操作，产出新的 `origin: 'human-edit'` 版本并把已打开标签步进到该版本；Discard 清空待存列表。已提交操作默认折叠，待定操作只占一行摘要；回执里非空的 `failedOps` 会按下标与原因逐条列出未生效的操作。修改元素与引用芯片并排两栏，窄栏时上下堆叠：详情列窄于 440px 时引用芯片折到直接修改下方。
- **编辑选择** — 每行的 `+`/`−` 控件通过共享的 `composerSelections` store 把确切 artifact 版本与 target 引用进主 composer：raster 的可选归一化拖拽层对应区域 target，元素行则对应它的 `ScienceElementTarget`（`{ elementId, elementKind, axes, label, current }`，不带像素坐标）。每张 PNG 都提供归一化区域框选，包括带元素目录的版本。选择、悬停或聚焦元素不会遮挡 PNG。显示未保存的预览时，禁止新增元素与区域引用，直到保存或放弃修改。标注文字、系列的希腊字母和重复项序号在查看器、composer 与已发送消息中使用同一个命名函数；原始 id 保持不变。单纯画出区域或列出元素不会暂存任何东西；显式的 `+`/`−` 控件才会暂存或撤销确切 target 及其可选备注。每一份备注草稿都绑定到其确切的 artifact 身份（artifact id、版本，元素 target 还带元素 id），已暂存 target 的备注变化会立即同步。Composer chip 显示 artifact 的展示名（与标签栏相同的最新版本既定标题）、确切版本与本地化元素名称；`selection.logicalName` 仍是 Host 校验准入所依据的线上身份，不受展示文本影响。发送一条指令时，浏览器通过 `remote.scienceEdits.submit` 提交有序 `{ targets, instruction }` 请求。Host 在排入一条 `user/message` 前校验每个确切当前版本，并逐字段比对元素与被寻址的 chart catalog——区域 target 还要求 raster 媒体类型，并把选中图片铸造为消息附件；元素 target 既不读 store 也不铸造附件。任一缺失、媒体类型不匹配、格式错误、版本陈旧或目录不匹配的 target 会拒绝整条请求，并标明其列表位置。artifact viewer 不含第二个指令输入框或发送操作。
- **Review 备注** — 内容查看页列出 logical artifact 的私有备注，并针对当前确切版本接受新备注。添加与删除走专用 Remote 和 Session 投影；Host 强制执行 8,192 字符上限。空输入框分两行显示备注提示与隐私说明。备注只属于用户、绝不进入模型上下文，溯源下钻也不会复制它们。
- **溯源下钻** — 距内容视图一次工具栏点击之遥（见下文）；一条面包屑可返回内容视图。
- **成果库主页** — 一级「成果」页通过 `sessions.scienceLibrary` 提供 Session 所属 project 内每个 logical artifact 的一张最新版本卡片，并提供搜索、排序和网格／列表控制。一级「项目文件」页通过 `sessions.workspaceFiles` 提供可搜索的单层目录浏览；file tab 通过 `sessions.workspaceFile` 读取至多 2 MiB，并把支持的媒体类型交给现有内容 renderer。主页内部不再有额外的分区开关。选中的页面每次显示时刷新，当前 Session 的 artifact 投影变化时也会刷新。
- **对账条幅** — 当 `scienceLibrary` 的 `health.reconstructed` 或 `health.missingContent` 非零时，「成果」页显示一条非模态条幅（`ReconcileBanner`，`ScienceDetailsView.tsx`），标出各自的计数，并可展开受影响成果的清单（取自每条成果自己的 `latest.health` 标记——仅当其确切的 latest 版本恰是受影响版本之一；`health` 计入但并非该成果 `latest` 行的、较旧的受影响版本不会单独列出）。`health.orphan` 无论在条幅还是逐项标记里都从不提及：孤儿版本是 `dsh-science-artifact-store` 文档已接受的正常崩溃窗口结果，不值得当作警告呈现。`latest.health.missingContent` 已置位的库内打开标签页，会以明确的"内容已丢失"文案取代其内容，工具栏禁用下载（图片版本还会隐藏放大），而不是尝试一次注定失败的加载——这种处理只覆盖 `scienceLibrary` 响应标记的那个确切最新版本；版本步进器还够不到等价处理（更旧的版本完全没有逐项健康标记）。

无论自身 `science` 投影处于什么状态，viewer 对任何当前会话都渲染产物库：Science 模式尚未绑定的会话（`science === null`——空白会话，或还没出现第一条 `science/mode-bound` 事件的会话）渲染的库主页，与一个已绑定但没有产物的会话完全一样，背后用一个惰性占位投影（`EMPTY_SCIENCE_PROJECTION`，`ScienceDetailsView.tsx`）支撑——库本身经 `sessions.scienceLibrary` 加载，这是一条项目级 RPC，与任何单一会话的投影无关，因此不需要真正绑定就能显示。缺失投影支持（`science === undefined`——本次部署压根没有组合 Science 会话投影）、附件不可用，以及指向投影已无法解析的 artifact/版本的失效标签页，仍各自渲染不同文案。

**设计说明——原仪表盘中的事实去了哪里。** 常驻的环境概览与运行列表不会重新出现为会话级面板小节。环境事实只存在于溯源下钻的「环境」子标签页，作用域是某一个 artifact 的运行。Outcome 保留在折叠的 `publish_outcome` 会话单元格中，不再有独立 Details 目的地或落地视图小节。

Artifact 缩略图与内容通过本包自己的会话作用域加载器（`science-artifact-url-loader.ts`）解析，而非会话界面拥有的附件加载器。两者都解析成 `scienceArtifactUrl(sessionId, versionId)`——Host 的原始字节 GET 路由，接受 Session fold 证明的版本、经确认的跨 Session input，或 Session 所属 project 中的精确成员，原样流式传输、不经 base64。`loadImage` 立即解析成这个 URL 本身（作为 `<img src>` 目标）；`loadText` `fetch()` 它并返回解码后的响应文本。两者都不保留第二套持久缓存。`science-attachment-loader.ts` 原来那套 base64 loader（`ISession.readScienceArtifact`）仍在，但本包任何注册都不再接它——见已知限制。

**CSV 表格（`ArtifactTable.tsx`）是本包内部组件，而非 `dsh-client-ui-primitives` 的导出。** 设计阶段对 `packages/client` 的一次全仓库搜索没有发现任何表格组件，也没有会需要它的第二个消费方；`JsonTree`/`MarkdownText` 之所以原样复用 `ui-primitives` 里的实现，是因为它们已经为其他消费方存在于那里。解析逻辑（`csv.ts`）是手写的、类 RFC4180 解析器（带引号字段、字段内嵌逗号/换行、双引号转义），而非一个依赖：这是对自动捕获或模型标注文件的只读预览，从不涉及任意不受信任的上传，"可配置性不能作为提供不受支持……公开操作集的理由"（`packages/AGENTS.md`）对一个投机性共享基础组件同样适用。未来出现真正的第二个消费方，才是把两者提升进 `ui-primitives` 的触发条件，而不是这一个。

## 文件 toggle
<a id="files-toggle"></a>

toggle 渲染在何处由本包 Host `Config` 中的 `toggleScope` 决定：`session`（默认）或 `global`，经 `z.union(['session', 'global'])` 校验。`session` 对应通用 Web 的呈现门控：该 action 注册进 `conversation.session.header.utilities`，除非当前 Session summary 的 `agentPreset` 指向内置 `science` preset，否则什么都不渲染——Standard 或自定义的非 Science Session 不会显示该 action——并额外注册一个 `conversation.page.utilities` 条目（`ScienceHeroAction`），在当前 Session 为空白且已被指派为 `science` preset 时覆盖欢迎页（该 Session 一旦开始，header 就会接管这个 action）。`global` 则改为注册唯一一个无条件的 `conversation.page.utilities` action（`ScienceGlobalToggle`），完全跳过 session-header 的注册，因此该 toggle 在应用全局可见——在选中任何工作区之前、在任何 Session 存在之前都可见，并在此后每一种 Session 状态下都保持是它唯一的所有者；没有任何 Session 状态会门控它。激活其中任意一个注册都会调用宿主提供的 toggle 回调（`session` 模式下是 `toggleDetailsView('science')`，`global` 模式下是 `toggleDetails`），因此同一个控件既打开 Details 列也关闭它；它不会打开自己的面板，也不持有任何面板状态。

Host 半侧在每个插件包之前（`webserver/index-inject`，仿照 `@deepseek-ai/dsh-client-ui-theme` 自身的启动值注入方式）把解析出的 `toggleScope` 发布为一个 `globalThis` 启动值——浏览器半侧在自己的 `apply()` 中同步读取一次；缺失或格式不正确的值会回退为 `session`。

## 溯源下钻

从 artifact viewer 的工具栏进入（不是一个独立的 `conversation.view` 标签页，也不是一个按键分派的 `conversation.details.header.actions` 条目）：一条面包屑（`<图表标题> › 溯源`），其根节点点击后返回内容视图，下方是活跃标签页所解析版本当前的内容来源（`run-auto`/`human-edit`/`import`，本地化）与生成时间。

此前的代码/执行日志/消息/环境这四个子标签页——它们分别解析出确切生产运行的源代码、stdout/stderr、生成轮次与环境绑定——已经没有了：T1/T2 产物权威性迁移从客户端安全的产物投影里移走了 `runId`/`toolCallId`/`producerSessionId`，没有任何读路径能替代这四个子标签页需要的那次精确运行查找。`ScienceArtifactProvenance.tsx` 总是针对一个已经解析好的版本渲染，它自己不带"不可用"分支（artifact viewer 在到达这个组件之前，就已经渲染过不可用/加载中状态）。

## 工作台外壳

除了上面的文件 toggle 与 Details 条目之外，本包还通过 ui-conversation 与 ui-sidebar 声明的附加 slot 组装工作台的其余部分，每一处都按当前 Session 的 `agentPreset` 门控（若无 Session，则按一个已经指派为 `science` preset 的空白 Session 门控）——除 `global` 模式下的文件 toggle 之外，没有任何 Science 表面会出现在另一个 preset 之下，或在完全没有 Session 时出现：

- **`sidebar.destinations`**（`ScienceDestinations`） — 在当前 Science Session 的侧边栏中贡献一个产物行；没有当前 Science Session 时不渲染。点击它始终落到成果库的 Artifacts 页:它打开 `science` Details 条目,随后——经由该条目自身的 `conversation.details.view` 注册在挂载期间绑定的按会话「回到成果库」回调(`index.ts` 中的 `libraryReturners`,由根作用域的侧边栏注册读取,因为它无法声明该条目按会话作用域的 selection store)——把该条目的 selection store 从任何已打开的产物标签、Project files 页或残留的持久化选择重置回来。
- **`conversation.page.utilities`** — 文件 toggle 在 `session` 模式下的欢迎页交接注册（`ScienceHeroAction`），或在 `global` 模式下的唯一注册（`ScienceGlobalToggle`）；见[文件 toggle](#files-toggle)。
- **`conversation.input.accessory`**（`ScienceComposerChips`） — 主 composer 上方以可移除 chip 形式展示的暂存 target，读取本包私有的、按会话划分的 `ScienceComposerSelections` 存储——artifact viewer 的 `+`/`−` 控件写入的正是同一个存储。一个注册的 `registerSubmissionHandler` 会在有任意 target 暂存时抢先认领一次普通发送，调用 `remote.scienceEdits.submit` 提交暂存的 target 与作为指令的 composer 文本，并只在 Host 接受后才清空暂存的 target；携带普通图片的提交会在触达 Remote 之前就被拒绝。
- **`conversation.composer.dock`**（`ScienceKernelStatus`） — composer 下方展示的、来自 `science` 投影 `kernels` 列表的逐语言最新生命周期状态（`live`/`exited`/`interrupted`）；没有投影或没有存活内核时不渲染任何内容。
- **`details.files`**（`ScienceEmptyDetails`） — 真正的欢迎页（完全没有当前 Session）时 Details 列的占位内容——`ui-layout` 的 `AppFrame` 只在这一态渲染这个 slot；只要有当前 Session（含空白、含 Science 未绑定）都改为在普通的 `details` slot 里渲染共享产物库（见 [Artifact viewer](#artifact-viewer-details-entry)）。说明打开一个会话后这里会显示项目产物，并通过宿主提供的 `closeDetails` 关闭该列。

## 组装

请在 `@deepseek-ai/dsh-client-ui-tool`、`@deepseek-ai/dsh-client-ui-attachment`、`@deepseek-ai/dsh-client-ui-conversation`（header action 与 Details 条目所在的座位）、客户端 locale/runtime 包、`@deepseek-ai/dsh-client-ui-settings`（`ctx.settingsScope`），以及会暴露 `science` 会话投影的 Host 组合之后加载本浏览器插件。已发布的 Web bundle 会以有意留空的配置档案映射挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，因此在有人填写 Python/R Conda 前缀并重启 Host 之前，卡片会以未配置的 `science` 配置档案出现；CLI 与 headless bundle 保留各自显式的 Runtime 组合，不显示该卡片。本包的 Host 行（`main` 入口）订阅 `webserver/index-inject` 时并未声明 `webServer` 注入（仿照 `@deepseek-ai/dsh-client-ui-theme` 自身的 Host 半侧）；没有 webserver 行的组合只是永远不会收集到这次订阅。桌面应用的 overlay（`apps/desktop/src/runtime-overlay.ts`）会为这一行设置 `toggleScope: global`，因为它自己的 overlay 已经把 Science 强制设为产品默认值。

## 模型体验

无，因为本包不组装 provider request；artifact 查看器可以请求 Host 的 `scienceEdits` Remote（`@deepseek-ai/dsh-tool-science` 的 "Viewer edit message" 一节）校验已提交的选择，并把模型读取的结构化精确版本 user message 排入队列。

#### KV Cache 影响

没有；本包既不组装也不发送 provider request。

## 已知限制与暂缓事项

- **预览只用于六种直接操作** — 标题、副标题、轴标签、图例位置、网格与字体变更使用 Runtime 的防抖预览路径。只可引用的元素选择不会渲染或修改图表，也不会在 PNG 上覆盖选择框。引用元素的已记录当前值有颜色时，元素名后才显示色块。
- **运行中行的执行摘要是静态的，不是实时 tail** — Runtime 与浏览器之间尚无 stdout 增量通道，因此运行中的 `run_python`/`run_r` 行显示固定的「正在执行…」，而不是画板设想的最新 stdout 行预览，直到该通道存在为止。
- **内核退出行的「查看退出原因」跳转到失败调用，而非其自身的 `kernel-state` 事件** — 该行复用与其他状态相同的调用级轨迹 `inspect`；跳转到精确的 `science/kernel-state` 事实是后续导航工作。
- **不支持内存 DataFrame 提升** — 一次只产生内存值（画板中的「df — …」行）的 `run_python`/`run_r` 结果，在 Notebook/Compute 数据地基阶段落地前，没有可提升的产物式 chip。
- **轮末产物依赖标签化 presentation 元数据** — 如果某个已完成 turn 的工具未发布 `science/artifact` presentation 值，即使独立投影稍后包含相关文件，该 turn 也没有产物组。
- **没有独立 artifact 缓存** — 会话附件继续使用会话界面拥有的加载器。Science 缩略图与内容通过 `scienceArtifactUrl` 上的无状态加载器解析；两条路径都不添加自己的持久化 Map 缓存（`useScienceVersionSummaries` 自己那份累积缓存只存元数据，从不存字节）。
- **C2 同轮次中间稿折叠不是降级，是没了** — 版本步进器以前会跳过一份同轮次的自检草稿，如果它被一个同时共享授权 turn 与产生 session 的更晚版本取代（`intermediate-versions.ts`，连同其测试一起删除）。那次折叠需要每个版本的 `origin`/`producerSessionId`/`turn`，全部被同一次迁移从客户端安全的产物投影里移走了；步进器现在不做任何折叠地走完全部持久版本。
- **`science-attachment-loader.ts` 的 base64 loader 待删** — `ISession.readScienceArtifact` 的 base64 RPC 及其 `createScienceImageLoader`/`createScienceTextLoader` 工厂仍在，但本包任何注册都不再接它们（`science-artifact-url-loader.ts` 的原始字节工厂已经在所有地方取代了它们），只是因为该 RPC 本身可能还有非浏览器消费者才保留（见原始字节读取 Agent Note 自己那次消费者 grep）。等没人再需要该 RPC 了就把两者一起删掉。
- **仅一个固定配置档案、两个字段** — 卡片只编辑内置 `science` 配置档案的 `pythonPrefix`/`rPrefix`，因为内置 preset 是当前唯一的产品消费方；其他部署配置档案 id 仍是文件/配置层面的事，不由浏览器管理。
- **没有发现、探测或即时生效** — 卡片从不列出、探测或校验某个 Conda 环境，也没有文件系统选择器或即时生效控件；已存储的前缀只有到下一次 Host 重启才会生效，卡片的 `pendingRestart`/`effective` 状态会上报这一点，但无法缩短等待。
- **环境历史仅保留单一版本** — `science` 投影只保留最新的一次环境绑定，因此一旦绑定发生变化，溯源下钻"环境"子标签页就无法展示某个较旧图表运行时的确切版本；它会转而报告仍然保留的版本号与指纹预览。
- **超过其适用渲染上限的文本 artifact 无法在原地完整浏览** — 表格与 JSON/text 使用 `MAX_ARTIFACT_TABLE_ROWS`/`MAX_ARTIFACT_TEXT_CHARACTERS`。下载仍会取回完整的持久化字节。
- **没有 PDF 图表导出** — 一个已禁用的本地化 Export 控件明确呈现该暂缓状态；确定性的 PDF 导出仍待后续实现。
- **不暴露任何结构化目标的 spec 无法添加 composer chip** — 目标发现沿 `layer`、`hconcat`/`vconcat`/`concat` 成员以及 `facet`/`repeat` 的子 `spec` 遍历 `mark`/`encoding.*`；一份不含这些结构的文档不提供结构选择，但只读渲染与下载仍然可用。
- **渲染出的图表没有文本替代** — PNG artifact 没有伴随的摘要或数据表替代形式；其源数据可能以独立 artifact 提供。
