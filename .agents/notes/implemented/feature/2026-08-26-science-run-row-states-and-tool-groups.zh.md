# Agent Note：Science 运行行八态与通用工具组

状态：已实现

[English](2026-08-26-science-run-row-states-and-tool-groups.md) | 中文

## 问题

Part 3 折叠的 `run_python`/`run_r` 单元格（一行状态，点击展开代码与已完成输出）对每个已结算调用一视同仁：运行成功、遇到普通异常、还是运行到一半内核死掉，看起来完全一样；一段长的或被截断的 stdout 也没有与短输出不同的呈现方式。另外，一串未被打断的普通 Tool 调用（一次 read、一次 grep、一次 write）会渲染成同样数量、互不关联的单行单元格，没有任何汇总，读者要逐个展开才能知道这一串步骤到底做了什么。

用户指认 8/19 的 `RunOutput.dc.html` 画板为该行八态的视觉权威（2026-08-26 裁决；画板其余部分——工作台布局、左侧导航、400px 对话栏、内核状态条——一律作废），并以 `CS-TURN-RENDERING-SPEC.md` 第 2/3 条作为通用 Tool 分组的对标权威。

## 决定

**八态全部来自既有事实。** `ScienceExecutionRow` 的状态由两处已经记录在案的来源推导：既有的 Tool 调用生命周期（`scienceToolRowState`，未改动）与联结的 `science` 会话投影运行条目，按 `toolCallId === callId` 匹配（`useProjection('science')`）。真正的工具级异常或运行中途遭遇轮次/会话中断，继续沿用改造前的纯折叠单元格（`FallbackRow`），不做改动。调用一旦正常结算，行还需要运行的原始 stdout/stderr 文本，而客户端安全投影刻意省略了它（`ScienceClientRunTerminal` 的文档写明："自由文本失败输出被省略"）——因此 `run-output.ts` 的 `splitRunResultSections` 通过定位 `tool-science` `formatRunResult` 的两个固定分节标记（`--- stdout ---`/`--- stderr ---`）,从每个已结算调用本就携带的展平工具结果文本中把它找回来。字节数与行数都从这段找回的文本客户端计算（`byteLength`/`countLines`），绝不依赖某个并不存在的 Host 上报数字；截断事实与 `KERNEL_DIED` 失败码则来自投影运行条目的结构化字段——一旦找到该条目即视为权威。只要两个来源中任意一个缺失——本次调用在 science 投影里没有对应的运行条目，或文本不携带这些标记（手搭建的测试夹具，或未来的格式变化）——该行就降级为同一个纯折叠单元格，而不是呈现一个既有事实并不支持的 Science 专属状态；好几个既有的 web e2e 夹具（`science-chart-outcome.e2e.ts`、`science-artifact-types.e2e.ts`）本就构造着这种非标准形态，改造后仍然经由未改动的降级路径渲染，因此它们的 golden 一个都没变。

八个状态：运行中（实时 `mm:ss`、静态「正在执行…」摘要——因为目前没有 stdout 增量通道——以及一个复用composer 自身控件的整轮级 Stop，经注入的 `cancel` 触发）；成功·短输出/长输出/表格/图表（超过 8 行保留即折叠，无论运行是否捕获了产物观感完全一致——捕获的产物绝不在行内渲染 chip，只在 P3 已经建好的轮末组出现）；成功·输出截断（折叠按钮改为标注保留末尾的字节数，并附一条解释上限的提示）；失败（错误色的两行末尾优先 stderr 摘要，完整调用栈藏在自己的折叠按钮后）；内核退出（琥珀色状态，标注已退出的序号与下一个序号，`inspect` 复用为「查看退出原因」——因为目前还没有针对单个 kernel-state 事件的导航）。

**思考附着到它后面紧邻的可见内容，不再自成一个气泡。** `chat/reasoning-attach.ts` 的 `attachReasoningNodes` 在 `groupAdjacentToolNodes` 之前对消息流顺序做一趟遍历。一个纯思考的 `assistant-step` 节点——只有非空文本的 `reasoning` 块；`tool-call` 占位块或空白的 `text` 块都不算别的可见内容——会从改写后的顺序里消失，其思考文本排队附着到下一个 kind 为 `tool-call` 或携带真实正文的 `assistant-step` 的 key 上。该后继节点承接这次附着，而不是让思考节点自己占一行，因此一个位于原本相邻工具调用串前面的 Think 步骤不再把这串调用拆开：`groupAdjacentToolNodes` 看到的是改写后的顺序，从不会看到已被摘除的思考 key，它自身的断组规则未变——`tool-call` key 依旧会并入一串，其余任何 kind（assistant 正文、委派/子 agent 卡、审查卡、完成摘要、压缩提示、用户消息）依旧断组。连续多个纯思考 key 会按先后顺序合并附着到同一个后继上。一个没有可附着后继的纯思考 key——仍在流式、轮次结束时后面什么都没有、或者下一个 key 是不可附着的 kind——原样留在顺序里：沿用现有的独立 Think 行作为兜底，因此思考文本绝不会被悄悄丢弃。

| Chat Node kind | 是否打断相邻的 `tool-call` 串 | 是否接受附着的思考 |
|---|---|---|
| `tool-call` | 否（本身就是串成员） | 是——`ChatNodeSeat` 自己的前置 `ReasoningRow` |
| 携带正文的 `assistant-step` | 是 | 是——合成前置 `reasoning` 块 |
| 纯思考的 `assistant-step` | 一旦被附着就不再生成自己的消息流 key | 不适用（是来源，不是目标） |
| user / steering / context | 是 | 否——该思考保持独立成行 |
| 委派/子 agent 卡、审查卡 | 是 | 否 |
| 完成摘要（agent-done/compute-done/子任务运行） | 是 | 否 |
| 压缩提示 | 是 | 否 |

呈现形态就是规范点名的那两种，绝不发明第三种。附着到 `tool-call` 的思考渲染为 `ChatNodeSeat` 自己的前置 `ReasoningRow`，作为该步骤卡片之前、同一个 flow-item 包裹内的兄弟节点——不改动 ui-tool 或 ui-science 里的 `tool.call.toolview`，因为从 `ui-conversation` 跨插件值导入 `ReasoningRow` 会触不过客户端打包纯净度关卡（`scripts/client-bundle-purity.spec.ts`）；附着到正文的思考被合成为前置 `reasoning` 块塞进那个 `assistant-step` 自己的 `blocks` 数组，经由 `AssistantMarkdown` 既有的 Think 摘要行渲染，与该步骤自身内联的思考块渲染方式完全一致。`ChatNodeSeat` 与 `ToolGroup` 收到的是每个 key 自己已解析出的 `attachedReasoning: readonly string[] | undefined` 切片，而不是共享的 `reasoningByKey` 查找 Map 本身——这张 Map 的身份在任何无关的消息流变化上都会改变（一个新流式 partial 的合成 key、另一个步骤结算完成），把它整个当作 prop 传下去会让 `ChatNodeSeat` 的 `memo` 短路在每一次这类无关变化上对每一个兄弟行都失效。两种形态都只是组件本地的界面状态：这次附着在每次相关渲染时都从 `order` 与 Chat Node 存储重新计算，从不写入日志，并且和这里的每个其他折叠一样，重新载入后默认收起。

**通用工具组，不是 Science 专属功能。** `ui-conversation` 的 `ChatView` 会把一串未被打断的、两个及以上的 `tool-call` Chat Node 折进一个 `ToolGroup`；单独一个调用仍是原有的单行。分组（`chat/tool-group.ts`）与渲染（`ChatView` 既有的 `<ChatNodeSeat>` 映射被包裹而非替换）都不引入 `ui-science` 或任何领域包——分类只读取调用的 wire 工具名，对于本模块不直接认识的名字，退回读取其声明的 render-intent card（`terminal`/`read`/`search`/`diff`/`web`，与 `ui-tool` 卡片模型已在用的同一套词汇），因此 Science 自己的 `run_python`/`run_r` 行（经既有的 `tool.call.toolview` 接缝注册）能正确参与分组，`ui-conversation` 里却没有一行 Science 专属代码。组标题按固定顺序汇总每个出现类别的数量；元数据行的失败数读取每个成员结构化的 `isError`，绝不靠猜文本。组默认收起（2026-08-26 真机验收推翻了 CS 文档记录的「组默认展开」；成员行仍和此前一样默认折叠）；展开会在两行标题之下挂载每个成员行。两级状态都只是组件本地的界面状态，从不记入日志。

## 考虑过的替代方案

**为 `run_python`/`run_r` 声明一个携带结构化 stdout/stderr 的新 render-intent card，而不是从文本里找回。** 已否决：render-intent 的 `view` 是工具结果上的一个持久字段，新增一个就是 brief 明确禁止的新 Host 事实（"不新增 session 事件，不改模型可见内容"）；展平文本里已经确定性地携带了所需的一切，因为 `formatRunResult` 正是这同一产品自己的固定格式。

**直接读投影上的 `stdoutBytes`/`stderrBytes` 作为折叠按钮的字节数标签。** 已否决，改为直接测量找回的文本：那些字段报告的是截断前的*原始*大小，而折叠态标签需要的是*保留*末尾的大小；直接测量实际展示的文本完全不需要向客户端暴露任何 Runtime 常量（`MAX_OUTPUT_BYTES`）。

**用一张覆盖每个已知工具的硬编码名称到类别对照表来分类工具组成员。** 已否决：`ui-tool` 的 render-intent card 已经为每个愿意声明的工具（`read`/`search`/`diff`/`web`）承担了这份分类，只有从不声明 card 的工具才需要名字字面量（从不走 `ui-tool` 的 `run_python`/`run_r`，外加为了应对尚无 card 的窗口期调用头而加入的 `bash`/`pwsh`）——以 `card` 优先的设计天然更通用，需要的字面量也少得多。

**让组容器自带一个 `data-chat-anchor-key`。** 已否决：`ChatView` 的滚动/分页锚点逻辑已经把每个 `[data-chat-anchor-key]` 元素当作可独立还原的位置，一个既有单元测试断言着未成组消息流的精确锚点 key 列表；给组再加一个只会让这份列表变长，还与成员自身的 key 轻度重复，对定位毫无帮助。收起的组，其成员在重新展开前会失去各自的锚点 key——这是一个已接受、已记录的降级（见 `ui-conversation` README 的已知限制）。

**在每个工具行自己的展开体内渲染 Think 折叠区（`ToolRow` 的 `bodyWrap`，或 Science 自己那三个 toolview 组件内部）。** 已否决：`ui-tool` 与 `ui-science` 是与 `ui-conversation` 相互独立的插件，两边都不能跨这道边界对 `ReasoningRow` 做运行时值导入（客户端打包纯净度）。为了绕开这条限制而在每个 toolview 包里各自复制一份 Think 折叠呈现，正好就是 brief 禁止的"第三种 Think 外观"。把折叠渲染为 `ChatNodeSeat` 自己的前置兄弟节点——仍在同一个 flow-item 包裹内，紧贴在该步骤卡片之上——让 ui-tool 与 ui-science 都不用改动，并且让唯一的 `ReasoningRow` 组件无条件地用于每一种 `tool-call`，包括 Science 自己的 `run_python`/`run_r`。

## 后果

`ScienceExecutionRow` 既有的 e2e 覆盖不需要刷新 golden：改造之前的每份夹具，要么走的是未改动的降级分支（`stopped`/`error`，或文本不携带 `formatRunResult` 标记的已结算调用），要么捕获的是这次行改造完全不涉及的详情列 ARIA 快照。`science-stop.e2e.ts` 在原有 Stop 场景所用的同一套真实 Runtime/子进程/浏览器栈上新增了三个场景——一次成功结算（内核徽标、完整 stdout）、两次相邻的成功调用折进一个真实生成的组标题、一次真实的内核崩溃渲染出内核退出状态——无需新建一整套夹具家族即可端到端证明这次改造。八态的完整矩阵（含标记解析失败与运行条目缺失的降级路径）在 `ui-science` 里有单元测试覆盖到逐文件 100%。`chat/tool-group.ts` 与 `chat/reasoning-attach.ts`——两个纯函数，用表格化测试覆盖了每一种折叠/分组组合，包括一个 Think 行附着在原本会被拆散的工具调用串前面的场景——单独扫描时都达到逐文件 100%；`packages/client/ui-conversation/src/client/*` 整体处在一条早于本次任务就存在的覆盖率豁免之下（`vitest.config.ts`，"GUI debt exemption"），项目的 `pnpm run test:coverage` 关卡并不解除这条豁免，因此 `ChatNodeSeat.tsx` 与 `AssistantNodeView.tsx` 里剩下的少数缺口，经逐行比对确认都是这次改动未曾触碰的既有分支（并非本次改动新欠下的债）。

延后事项，与 brief 一致：把内存中的 DataFrame 结果提升为产物式行，留待 Notebook/Compute 数据地基阶段；内核退出态上的「重启并重跑」操作不做，以保证重跑始终经由模型/对话发起，而不是一个会破坏轨迹一致性的直连客户端控件。把 Think 折叠的呈现进一步延伸进 ui-tool 的 `ToolRow`（嵌套在该行自己的展开体内，更贴合 brief 字面暗示的位置）本次延后：`ChatNodeSeat` 的兄弟节点摆法已经满足"不再独立成行、不打断分组、不发明第三种外观"这同一份约定，且不需要那种跨插件耦合——日后若决定把 Think 呈现改走一个共享能力接缝（而不是由 `ui-conversation` 独自拥有 `ReasoningRow`），届时可以重新评估由哪个包渲染它。
