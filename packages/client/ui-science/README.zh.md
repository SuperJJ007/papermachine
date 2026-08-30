# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

浏览器端的 Science 执行单元格、轮末产物组、过程视图、artifact viewer、Science 设置卡片和文件 toggle。本包只消费冻结的工具调用/结果数据与客户端安全的 `science` 会话投影；它不创建 Science 事实，也不改变模型可见内容。过程视图与 artifact viewer 共享同一投影和本包内部的产物选择状态存储。

直接修改行在自适应宽度的标签列中显示完整的本地化元素名。多子图按编号分组，整图行在前；单子图不显示分组标题。分组行以外的元素引用仅在 id 带 `axes[n].` 前缀时附加本地化子图号。产物和文件标签页位于 `conversation.details.header.tabs`，页面选择器位于头部第一行，两者读取同一个 selection store。

## 过程视图

「过程（Process）」以 `trajectory.view` id `process` 贡献，仅在会话的 preset 或已解析投影为 `science` 时可见。它排在「详细」之前，因此 Science 会话进入「轨迹」时默认显示过程，其他会话仍只有详细账本。单左轨右侧通栏排列 agent 与人工改图卡，人工改图保留用户图标与蓝色左边框。折叠的轮卡片有四个结构化行：截断的用户要求、通栏有序步骤条、右对齐的统计与展开控件，以及每个产物在本轮最终版本的小标签。要求之外不附加任何自由文本说明。长步骤条和产物标签行在卡片内换行。步骤条最多渲染 120 次调用并提示总数；展开清单仍然完整。

点击色块会展开卡片、高亮对应清单行并滚动到该行。展开后的每行包含 assistant 步号、种类标记、结构化标题、结果和该调用产出的产物版本。同一步的并行调用共享步号。同轮内连续成功的资料查看调用合并，包括跨步号的调用，但每次调用保留自己的色块、标题和锚点。失败、运行、标注、发布和委派都不合并。点击行标题会在「详细」中打开第一个成员；点击产物标签会在共享查看器中打开精确版本。展开与高亮只属于当前挂载的过程视图，切换详细后仍保留，但不落盘。

标题取自工具名、经校验的 JSON 参数字段和 Science 事件。文件名省略目录，标注与发布标题截断到四十个字符。视图不解析代码或模型散文，不复制 Assistant 文本、stdout 或 stderr。运行状态和时长以 run 记录为准，其他失败来自工具结果的错误标志。步骤统计计算不同的 assistant 步号，包括没有工具调用的步骤。会话统计对产物去重并累加轮次墙钟时长；缺少结束时间时回退到已完成运行的时长之和。

内核启动、退出和中断事实显示为时间线标记，不单独渲染环境卡。终态 epoch 同时提供启动和结束标记；退出原因说明变量何时清空。标记优先放在包含其时间戳的轮次之前（含起止时刻），否则放在之后开始的第一轮之前，再否则放在最后一轮之后。没有结束时间的轮次包含其开始时刻及之后的全部时间戳。当前环境可用时，启动标记显示其 profile 名。

可见性通过 `ctx.trajectorySubviews.registerVisibility('process', source)` 注册。会话列表变化时，该 source 会重新绑定投影订阅，因此 preset 指派、Session 创建、投影解析、插件卸载与热更新都会直接使轨迹内层切换器失效并重算。

标注标题需要逻辑名称和标题；仅在调用提供数字版本号时显示版本。

步骤条与清单标记共用两种状态色和中性形状：柔和绿色运行方块、红色失败方块、浅中性的资料查看／委派／其他方块、中性空心标注方块，以及中性实心发布圆点。结果使用辅助文字色的纯文本，失败为红色；蓝色只标识选中行与人工操作。

## 轮末产物

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

`registerTranscriptDetailVisibility`（`ui-conversation` 的 `IConversation`）会为满足过程视图资格的会话隐藏对话流中的上下文注入展开行，以及每轮的 `用时`/TTFT/吞吐标签（`createTranscriptDetailVisibilitySource`，与过程视图自身可见性来源同一套响应式判定逻辑，取反）。两者都仍可从持久日志重建——上下文行经由 Trajectory 详细子视图，计时数字经由 composer dock 的全会话统计条，本抑制机制不影响后者。`ui-conversation` 自身无条件渲染两者，仅通过其 `processDetailVisible` chat-node Hook 咨询已注册的来源，因此不携带任何 Science 专属代码；本包目前是唯一的注册方。

## Outcome 行

已完成的 `publish_outcome` 默认只显示单行版本摘要。展开单元格后才显示不可变的标题、Markdown 摘要和运行/图表/消息证据；精确图表引用仍通过当前客户端安全的 `science` 投影解析。展开状态仅存在于前端。

## 设置卡片

该卡片以固定的 `science-runtime` 命名空间——`@deepseek-ai/dsh-science-runtime/with-settings` 注册的命名空间，而非某个包名或产品 id——为键注册进 `settings.plugin.item`，因此只要 Host 服务了该命名空间它就会出现，否则不留任何痕迹，也无需任何导航条目或 Host 侧改动。它通过 `ctx.settingsScope` 绑定该命名空间，只编辑 `['science', 'pythonPrefix']` 与 `['science', 'rPrefix']`（分节根部本身就是配置档案映射，以固定的 `science` 配置档案 id 寻址，而非包一层 `profiles` 字段），加上用于显式移除覆盖动作的 `unsetPath(['science'])`；没有任何代码路径会写入分节根部。两个字段都是 `role('secret')`，其存储值从不出现在任何 settings 响应里——卡片从 `SettingsScopeSnapshot.secrets` 获知逐字段的存在状态，并且从不把已存储的路径回显进输入框。留空的替换输入是空操作。卡片的状态行会把运行中 Host 的实际绑定状态与当前存储值对照后上报——`effective`（配置档案已绑定，且 Host 已经读取过）、`pendingRestart`（存储值与绑定值不一致，无论方向：Host 尚未读取的新保存值，或 Host 仍绑定着、已从存储中移除的旧值），或 `notConfigured`——读取自 `SettingsScopeSnapshot.effective`（Host 的 `applies: 'restart'` Science Runtime 入口在自身注册时读到的值，冻结至下一次 Host 启动）与 `.value`（当前存储的分节）的对照，而非某个客户端本地的标志位，因此页面刷新后这一判断保持不变。该卡片拥有自己的暂存与 revision 设栅，而不是把**插件配置**分区的卡片外观或暂存表单模型作为值导入——bundle 纯净度门禁禁止这样做。它的外观构建在 `@deepseek-ai/dsh-client-ui-primitives` 的共享原子之上——两个前缀字段用 `Input`，Configured/Not configured 徽章用 `Pill`，保存/放弃修改/移除覆盖都用 `Button`——而不是未加样式的原生元素，因此卡片与应用自身的控件保持一致；只有卡片容器的边框/圆角/背景，以及默认收起的 header/chevron 布局——没有任何原生组件提供这两者——才是本包自己的 CSS。收起时，可访问性树里只有 header（名称、描述与展开开关）——每个字段、提示与操作按钮都只在展开后才会渲染，与每个兄弟卡片的行为及可访问名称的措辞保持一致。

## 选择状态存储

artifact viewer 与会话记录行共享一个本包私有的按会话存储（`selection-store.ts`），其中 `openArtifacts` 是有序联合：`{ kind: 'artifact', artifactId, version }` 或 `{ kind: 'file', path }`。`activeTabId` 为 `artifact:<artifactId>`、`file:<path>`，或者在文件库主页处为 null；`libraryPage` 记住该主页显示产物还是项目文件。artifact 条目继续按 logical artifact 去重，并在唯一位置记录选中的持久版本。`view` 与 `provenanceSubTab` 仍是共享 viewer 字段：激活文档会回到 content，同时保留最近一次 provenance 子标签偏好。框架的「句柄 × 会话」缓存让该状态与会话记录行共享，并在 Details 列关闭再打开时继续存活。引擎以会话作用域的 localStorage 键持久化选择状态，包括文件库页与折叠分组，因此刷新浏览器后仍会恢复。

产物按产生它的对话分组，组可折叠，折叠状态随选择存储持久化。当前会话置顶，其他组按最新产物时间降序，排序只影响组内卡片。搜索过滤卡片并隐藏空组。组头显示会话标题、可见数量及最新相对时间，时间格式与侧边栏共享；网格卡片是一张有边框的整体——上半是通栏 1:1 缩略图（图片裁到左上角，非图片则居中显示文件类型磁贴），下半是脚注，显示标题与 `vN · 相对时间`，不再显示媒体类型文字。列表布局仍是 76px 缩略行，脚注文案与网格一致。`ProjectLibrary` 每次渲染只取一次 `Date.now()`，组头与每张卡片的脚注共用同一个值。

## Artifact viewer（Details 条目）
<a id="artifact-viewer-details-entry"></a>

viewer 以 id `science`、`primary: true` 注册进 `conversation.details.view`——会话未显式选定某个配置项时,Details 列默认显示的就是这一项(ui-conversation 的 `DetailsPanel.tsx resolveActiveDetailsView`;整个注册表最多一个条目可以声明 `primary`,第二个在注册时抛错)。它的 keyed `conversation.details.header.actions` 条目把一级「产物」与「项目文件」页签放进 Details header，同时由通用 shell 保留关闭控件。它渲染的数据来自 chart/Outcome 行读取的同一个 `science` Session 投影，加上上面的选择状态存储；写路径调用 Host 所有的 `scienceEdits` Remote，而不在浏览器里改写投影状态：

- **标签栏** — artifact tab 与 workspace file tab 共用同一条二级可关闭标签栏；没有打开文档时完全不渲染。文件库主页没有自己的文档 tab。点击任一一级页签会让活跃文档返回所选文件库页，但不关闭任何已打开 tab。点击会话记录 artifact 会打开其精确版本，工具栏返回键回到上次选择的文件库页，关闭最后一个文档也会自动回到那里。
- **工具栏** — 面向活跃标签页的内容视图：文件库返回键、一个版本步进器（‹ v*n* ›），以及溯源/下载/关闭标签页控件，加上仅在图像 artifact 上出现的放大控件（文本附件没有可放大的位图）。步进器默认只在两个相邻的非折叠版本间步进；当该 artifact 存在一个或多个同轮中间稿（`intermediate-versions.ts`——一个被同时共享授权 turn 与产生 session 的更晚版本取代的版本，永远不含 human-edit 保存）时，会出现一个「中间稿 ×*N*」按钮，点开后把它们临时纳入步进，直到再次收起（组件本地状态，切换到另一个 artifact 的标签页时重置）。溯源下钻按每个版本自身的确切标题列出全部版本。下载通过同一个会话作用域加载器解析持久化字节（图像用 `loadImage`，文本用 `loadText`），并经由一个临时的 URI 锚点触发浏览器保存——图像是 `loadImage` 给出的 `data:` URI，文本则是基于 `loadText` 已解码字符串构建的 `data:` URI；放大打开共享灯箱（第二个、由存储驱动的 `ImageLightbox` 实例，因为工具栏与内容图片自身的私有点击展开状态是兄弟关系，而非其祖先）。
- **内容**（`ArtifactContent.tsx`） — 按 artifact 的持久化 project-store 媒体类型分派：`image/png` 经本包的 `ScienceArtifactImage` 渲染；文本媒体类型通过 `loadText` 取得并解码字节后再次分派——`text/csv` 渲染为可排序、可滚动的表格（`ArtifactTable.tsx`），`application/json` 渲染为 `JsonTree`（来自 `@deepseek-ai/dsh-client-ui-primitives`），`text/markdown` 经由 `MarkdownText` 渲染，`text/plain` 渲染为预格式化文本。面向用户的内容不显示内部运行 id 与原始字节数。JSON 与纯文本在渲染前应用 `MAX_ARTIFACT_TEXT_CHARACTERS`（100,000），CSV 表格最多渲染 `MAX_ARTIFACT_TABLE_ROWS`（500）行。这些固定的浏览器呈现上限（`format.ts`）不是 `Config` 字段，也不改变部署的持久化文件准入上限。
- **图表编辑**（`ScienceChartEditPanel.tsx`）— 对 `chart` 可寻址的 `image/png` 版本，在 raster 内容下方挂一张无卡片、无折叠层级的紧凑常显表单，直接提供标题／副标题、x/y 轴标签、网格、字体族／字号与图例位置控件。这些控件生成封闭的 `set_title`、`set_axis_label`、`toggle_grid`、`set_font` 与 `set_legend_position` 操作。字体字段通过简短固定候选表接受自由输入，不枚举已安装字体；字体不可用时显示本地化操作失败。每个可直接编辑行只能通过自身 `+`/`−` 操作添加精确引用，点击行或编辑控件都不改变引用状态。其余已抽取元素显示为紧凑引用 chip，整个 chip 都可切换引用；annotation 只常显前六项，其余由一个数量控件展开。直接改动在组件本地态里累积为待存 `ScienceChartOp`——全程不经模型、不进 session log——并通过 Runtime 获得防抖预览；引用变化绝不请求预览。Save 经注入的 `applyChartOps`（`scienceEdits.applyChartOps`）提交待存操作，产出新的 `origin: 'human-edit'` 版本并把已打开标签步进到该版本；Discard 清空待存列表。已提交操作默认折叠，待定操作只占一行摘要；回执里非空的 `failedOps` 会按下标与原因逐条列出未生效的操作。修改元素与引用芯片并排两栏，窄栏时上下堆叠：详情列窄于 440px 时引用芯片折到直接修改下方。
- **编辑选择** — 每行的 `+`/`−` 控件通过共享的 `composerSelections` store 把确切 artifact 版本与 target 引用进主 composer：raster 的可选归一化拖拽层对应区域 target，元素行则对应它的 `ScienceElementTarget`（`{ elementId, elementKind, axes, label, current }`，不带像素坐标）。对 `chart.chart` 可寻址的版本，`ArtifactContent.tsx` 的 `RasterArtifact` 会隐藏手动 region 拖拽选择——按钮、拖拽层与已画区域的 chip 行——没有可寻址图表结构的 PNG 则保留 region 选择作为其唯一引用方式。单纯画出区域或列出元素不会暂存任何东西；显式的 `+`/`−` 控件才会暂存或撤销确切 target 及其可选备注。每一份备注草稿都绑定到其确切的 artifact 身份（artifact id、版本，元素 target 还带元素 id），已暂存 target 的备注变化会立即同步。Composer chip 显示 artifact 的展示名（与标签栏相同的最新版本既定标题）、确切版本与本地化元素名称；`selection.logicalName` 仍是 Host 校验准入所依据的线上身份，不受展示文本影响。发送一条指令时，浏览器通过 `remote.scienceEdits.submit` 提交有序 `{ targets, instruction }` 请求。Host 在排入一条 `user/message` 前校验每个确切当前版本，并逐字段比对元素与被寻址的 chart catalog——区域 target 还要求 raster 媒体类型，并把选中图片铸造为消息附件；元素 target 既不读 store 也不铸造附件。任一缺失、媒体类型不匹配、格式错误、版本陈旧或目录不匹配的 target 会拒绝整条请求，并标明其列表位置。artifact viewer 不含第二个指令输入框或发送操作。
- **Review 备注** — 内容查看页列出 logical artifact 的私有备注，并针对当前确切版本接受新备注。添加与删除走专用 Remote 和 Session 投影；Host 强制执行 8,192 字符上限。备注只属于用户、绝不进入模型上下文，溯源下钻也不会复制它们。
- **溯源下钻** — 距内容视图一次工具栏点击之遥（见下文）；一条面包屑可返回内容视图。
- **文件库主页** — 一级「产物」页通过 `sessions.scienceLibrary` 提供 Session 所属 project 内每个 logical artifact 的一张最新版本卡片，并提供搜索、排序和网格／列表控制。一级「项目文件」页通过 `sessions.workspaceFiles` 提供可搜索的单层目录浏览；file tab 通过 `sessions.workspaceFile` 读取至多 2 MiB，并把支持的媒体类型交给现有内容 renderer。主页内部不再有额外的分区开关。选中的页面每次显示时刷新，当前 Session 的 artifact 投影变化时也会刷新。

无论自身 `science` 投影处于什么状态，viewer 对任何当前会话都渲染产物库：Science 模式尚未绑定的会话（`science === null`——空白会话，或还没出现第一条 `science/mode-bound` 事件的会话）渲染的库主页，与一个已绑定但没有产物的会话完全一样，背后用一个惰性占位投影（`EMPTY_SCIENCE_PROJECTION`，`ScienceDetailsView.tsx`）支撑——库本身经 `sessions.scienceLibrary` 加载，这是一条项目级 RPC，与任何单一会话的投影无关，因此不需要真正绑定就能显示。缺失投影支持（`science === undefined`——本次部署压根没有组合 Science 会话投影）、附件不可用，以及指向投影已无法解析的 artifact/版本的失效标签页，仍各自渲染不同文案。

**设计说明——原仪表盘中的事实去了哪里。** 常驻的环境概览与运行列表不会重新出现为会话级面板小节。环境事实只存在于溯源下钻的「环境」子标签页，作用域是某一个 artifact 的运行。Outcome 保留在折叠的 `publish_outcome` 会话单元格中，不再有独立 Details 目的地或落地视图小节。

Artifact 缩略图与内容通过本包自己的会话作用域加载器（`science-attachment-loader.ts`）解析，而非会话界面拥有的附件加载器。两者都调用 `ISession.readScienceArtifact(versionId)`：Host 接受 Session fold 证明的版本、经确认的跨 Session input，或 Session 所属 project 中的精确成员。`loadImage` 把返回字节转换为 `data:` URI；`loadText` 以严格 UTF-8 解码。两者都不保留第二套持久缓存。

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

- **`sidebar.destinations`**（`ScienceDestinations`） — 在当前 Science Session 的侧边栏中贡献一个产物行；它打开 `science` Details 条目，没有当前 Science Session 时不渲染。
- **`conversation.page.utilities`** — 文件 toggle 在 `session` 模式下的欢迎页交接注册（`ScienceHeroAction`），或在 `global` 模式下的唯一注册（`ScienceGlobalToggle`）；见[文件 toggle](#files-toggle)。
- **`conversation.input.accessory`**（`ScienceComposerChips`） — 主 composer 上方以可移除 chip 形式展示的暂存 target，读取本包私有的、按会话划分的 `ScienceComposerSelections` 存储——artifact viewer 的 `+`/`−` 控件写入的正是同一个存储。一个注册的 `registerSubmissionHandler` 会在有任意 target 暂存时抢先认领一次普通发送，调用 `remote.scienceEdits.submit` 提交暂存的 target 与作为指令的 composer 文本，并只在 Host 接受后才清空暂存的 target；携带普通图片的提交会在触达 Remote 之前就被拒绝。
- **`conversation.composer.dock`**（`ScienceKernelStatus`） — composer 下方展示的、来自 `science` 投影 `kernels` 列表的逐语言最新生命周期状态（`live`/`exited`/`interrupted`）；没有投影或没有存活内核时不渲染任何内容。
- **`details.files`**（`ScienceEmptyDetails`） — 真正的欢迎页（完全没有当前 Session）时 Details 列的占位内容——`ui-layout` 的 `AppFrame` 只在这一态渲染这个 slot；只要有当前 Session（含空白、含 Science 未绑定）都改为在普通的 `details` slot 里渲染共享产物库（见 [Artifact viewer](#artifact-viewer-details-entry)）。说明打开一个会话后这里会显示项目产物，并通过宿主提供的 `closeDetails` 关闭该列。

## 组装

请在 `@deepseek-ai/dsh-client-ui-tool`、`@deepseek-ai/dsh-client-ui-attachment`、`@deepseek-ai/dsh-client-ui-conversation`（header action 与 Details 条目所在的座位，以及 artifact viewer 溯源下钻复用的 Details 座位 `inspectCall` 宿主回调）、客户端 locale/runtime 包、`@deepseek-ai/dsh-client-ui-settings`（`ctx.settingsScope`），以及会暴露 `science` 会话投影的 Host 组合之后加载本浏览器插件。已发布的 Web bundle 会以有意留空的配置档案映射挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，因此在有人填写 Python/R Conda 前缀并重启 Host 之前，卡片会以未配置的 `science` 配置档案出现；CLI 与 headless bundle 保留各自显式的 Runtime 组合，不显示该卡片。本包的 Host 行（`main` 入口）订阅 `webserver/index-inject` 时并未声明 `webServer` 注入（仿照 `@deepseek-ai/dsh-client-ui-theme` 自身的 Host 半侧）；没有 webserver 行的组合只是永远不会收集到这次订阅。桌面应用的 overlay（`apps/desktop/src/runtime-overlay.ts`）会为这一行设置 `toggleScope: global`，因为它自己的 overlay 已经把 Science 强制设为产品默认值。

## 模型体验

无，因为本包不组装 provider request；artifact 查看器可以请求 Host 的 `scienceEdits` Remote（`@deepseek-ai/dsh-tool-science` 的 "Viewer edit message" 一节）校验已提交的选择，并把模型读取的结构化精确版本 user message 排入队列。

#### KV Cache 影响

没有；本包既不组装也不发送 provider request。

## 已知限制与暂缓事项

- **预览只用于五种直接操作** — 标题、轴标签、图例位置、网格与字体变更使用 Runtime 的防抖预览路径。只可引用的元素选择不会渲染或修改图表。
- **运行中行的执行摘要是静态的，不是实时 tail** — Runtime 与浏览器之间尚无 stdout 增量通道，因此运行中的 `run_python`/`run_r` 行显示固定的「正在执行…」，而不是画板设想的最新 stdout 行预览，直到该通道存在为止。
- **内核退出行的「查看退出原因」跳转到失败调用，而非其自身的 `kernel-state` 事件** — 该行复用与其他状态相同的调用级轨迹 `inspect`；跳转到精确的 `science/kernel-state` 事实是后续导航工作。
- **不支持内存 DataFrame 提升** — 一次只产生内存值（画板中的「df — …」行）的 `run_python`/`run_r` 结果，在 Notebook/Compute 数据地基阶段落地前，没有可提升的产物式 chip。
- **轮末产物依赖标签化 presentation 元数据** — 如果某个已完成 turn 的工具未发布 `science/artifact` presentation 值，即使独立投影稍后包含相关文件，该 turn 也没有产物组。
- **没有独立 artifact 缓存** — 会话附件继续使用会话界面拥有的加载器。Science 缩略图与内容通过 `ISession.readScienceArtifact` 上的无状态加载器解析；两条路径都不添加自己的持久化 Map 缓存。
- **仅一个固定配置档案、两个字段** — 卡片只编辑内置 `science` 配置档案的 `pythonPrefix`/`rPrefix`，因为内置 preset 是当前唯一的产品消费方；其他部署配置档案 id 仍是文件/配置层面的事，不由浏览器管理。
- **没有发现、探测或即时生效** — 卡片从不列出、探测或校验某个 Conda 环境，也没有文件系统选择器或即时生效控件；已存储的前缀只有到下一次 Host 重启才会生效，卡片的 `pendingRestart`/`effective` 状态会上报这一点，但无法缩短等待。
- **环境历史仅保留单一版本** — `science` 投影只保留最新的一次环境绑定，因此一旦绑定发生变化，溯源下钻"环境"子标签页就无法展示某个较旧图表运行时的确切版本；它会转而报告仍然保留的版本号与指纹预览。
- **已打开的标签页不做持久化保存** — 选择状态存储只存在于框架按 (句柄, 会话) 划分的缓存里，而非 `localStorage`：在同一次页面加载内，已打开的标签页与当前视图能在 Details 列关闭再重新打开、或会话切换再切回之间保持不变，但无法跨越一次页面刷新。
- **超过其适用渲染上限的文本 artifact 无法在原地完整浏览** — 表格与 JSON/text 使用 `MAX_ARTIFACT_TABLE_ROWS`/`MAX_ARTIFACT_TEXT_CHARACTERS`。下载仍会取回完整的持久化字节。
- **没有 PDF 图表导出** — 一个已禁用的本地化 Export 控件明确呈现该暂缓状态；确定性的 PDF 导出仍待后续实现。
- **不暴露任何结构化目标的 spec 无法添加 composer chip** — 目标发现沿 `layer`、`hconcat`/`vconcat`/`concat` 成员以及 `facet`/`repeat` 的子 `spec` 遍历 `mark`/`encoding.*`；一份不含这些结构的文档不提供结构选择，但只读渲染与下载仍然可用。
- **渲染出的图表没有文本替代** — PNG artifact 没有伴随的摘要或数据表替代形式；其源数据可能以独立 artifact 提供。
