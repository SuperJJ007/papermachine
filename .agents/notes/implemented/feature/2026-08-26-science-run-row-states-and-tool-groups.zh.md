# Agent Note：Science 运行行八态与通用工具组

状态：已实现

[English](2026-08-26-science-run-row-states-and-tool-groups.md) | 中文

## 问题

Part 3 折叠的 `run_python`/`run_r` 单元格（一行状态，点击展开代码与已完成输出）对每个已结算调用一视同仁：运行成功、遇到普通异常、还是运行到一半内核死掉，看起来完全一样；一段长的或被截断的 stdout 也没有与短输出不同的呈现方式。另外，一串未被打断的普通 Tool 调用（一次 read、一次 grep、一次 write）会渲染成同样数量、互不关联的单行单元格，没有任何汇总，读者要逐个展开才能知道这一串步骤到底做了什么。

用户指认 8/19 的 `RunOutput.dc.html` 画板为该行八态的视觉权威（2026-08-26 裁决；画板其余部分——工作台布局、左侧导航、400px 对话栏、内核状态条——一律作废），并以 `CS-TURN-RENDERING-SPEC.md` 第 2/3 条作为通用 Tool 分组的对标权威。

## 决定

**八态全部来自既有事实。** `ScienceExecutionRow` 的状态由两处已经记录在案的来源推导：既有的 Tool 调用生命周期（`scienceToolRowState`，未改动）与联结的 `science` 会话投影运行条目，按 `toolCallId === callId` 匹配（`useProjection('science')`）。真正的工具级异常或运行中途遭遇轮次/会话中断，继续沿用改造前的纯折叠单元格（`FallbackRow`），不做改动。调用一旦正常结算，行还需要运行的原始 stdout/stderr 文本，而客户端安全投影刻意省略了它（`ScienceClientRunTerminal` 的文档写明："自由文本失败输出被省略"）——因此 `run-output.ts` 的 `splitRunResultSections` 通过定位 `tool-science` `formatRunResult` 的两个固定分节标记（`--- stdout ---`/`--- stderr ---`）,从每个已结算调用本就携带的展平工具结果文本中把它找回来。字节数与行数都从这段找回的文本客户端计算（`byteLength`/`countLines`），绝不依赖某个并不存在的 Host 上报数字；截断事实与 `KERNEL_DIED` 失败码则来自投影运行条目的结构化字段——一旦找到该条目即视为权威。只要两个来源中任意一个缺失——本次调用在 science 投影里没有对应的运行条目，或文本不携带这些标记（手搭建的测试夹具，或未来的格式变化）——该行就降级为同一个纯折叠单元格，而不是呈现一个既有事实并不支持的 Science 专属状态；好几个既有的 web e2e 夹具（`science-chart-outcome.e2e.ts`、`science-artifact-types.e2e.ts`）本就构造着这种非标准形态，改造后仍然经由未改动的降级路径渲染，因此它们的 golden 一个都没变。

八个状态：运行中（实时 `mm:ss`、静态「正在执行…」摘要——因为目前没有 stdout 增量通道——以及一个复用composer 自身控件的整轮级 Stop，经注入的 `cancel` 触发）；成功·短输出/长输出/表格/图表（超过 8 行保留即折叠，无论运行是否捕获了产物观感完全一致——捕获的产物绝不在行内渲染 chip，只在 P3 已经建好的轮末组出现）；成功·输出截断（折叠按钮改为标注保留末尾的字节数，并附一条解释上限的提示）；失败（错误色的两行末尾优先 stderr 摘要，完整调用栈藏在自己的折叠按钮后）；内核退出（琥珀色状态，标注已退出的序号与下一个序号，`inspect` 复用为「查看退出原因」——因为目前还没有针对单个 kernel-state 事件的导航）。

**通用工具组，不是 Science 专属功能。** `ui-conversation` 的 `ChatView` 会把一串未被打断的、两个及以上的 `tool-call` Chat Node 折进一个 `ToolGroup`；单独一个调用仍是原有的单行。分组（`chat/tool-group.ts`）与渲染（`ChatView` 既有的 `<ChatNodeSeat>` 映射被包裹而非替换）都不引入 `ui-science` 或任何领域包——分类只读取调用的 wire 工具名，对于本模块不直接认识的名字，退回读取其声明的 render-intent card（`terminal`/`read`/`search`/`diff`/`web`，与 `ui-tool` 卡片模型已在用的同一套词汇），因此 Science 自己的 `run_python`/`run_r` 行（经既有的 `tool.call.toolview` 接缝注册）能正确参与分组，`ui-conversation` 里却没有一行 Science 专属代码。组标题按固定顺序汇总每个出现类别的数量；元数据行的失败数读取每个成员结构化的 `isError`，绝不靠猜文本。组默认展开（P3b「全部收起」的默认值被修订为「组展开、成员折叠」——P3b 那篇 Agent Note 的最终形态陈述已就地更新，而非另立一篇相互矛盾的新记录）；收起会把每个成员行都隐藏到两行标题之外。两级状态都只是组件本地的界面状态，从不记入日志。

## 考虑过的替代方案

**为 `run_python`/`run_r` 声明一个携带结构化 stdout/stderr 的新 render-intent card，而不是从文本里找回。** 已否决：render-intent 的 `view` 是工具结果上的一个持久字段，新增一个就是 brief 明确禁止的新 Host 事实（"不新增 session 事件，不改模型可见内容"）；展平文本里已经确定性地携带了所需的一切，因为 `formatRunResult` 正是这同一产品自己的固定格式。

**直接读投影上的 `stdoutBytes`/`stderrBytes` 作为折叠按钮的字节数标签。** 已否决，改为直接测量找回的文本：那些字段报告的是截断前的*原始*大小，而折叠态标签需要的是*保留*末尾的大小；直接测量实际展示的文本完全不需要向客户端暴露任何 Runtime 常量（`MAX_OUTPUT_BYTES`）。

**用一张覆盖每个已知工具的硬编码名称到类别对照表来分类工具组成员。** 已否决：`ui-tool` 的 render-intent card 已经为每个愿意声明的工具（`read`/`search`/`diff`/`web`）承担了这份分类，只有从不声明 card 的工具才需要名字字面量（从不走 `ui-tool` 的 `run_python`/`run_r`，外加为了应对尚无 card 的窗口期调用头而加入的 `bash`/`pwsh`）——以 `card` 优先的设计天然更通用，需要的字面量也少得多。

**让组容器自带一个 `data-chat-anchor-key`。** 已否决：`ChatView` 的滚动/分页锚点逻辑已经把每个 `[data-chat-anchor-key]` 元素当作可独立还原的位置，一个既有单元测试断言着未成组消息流的精确锚点 key 列表；给组再加一个只会让这份列表变长，还与成员自身的 key 轻度重复，对定位毫无帮助。收起的组，其成员在重新展开前会失去各自的锚点 key——这是一个已接受、已记录的降级（见 `ui-conversation` README 的已知限制）。

## 后果

`ScienceExecutionRow` 既有的 e2e 覆盖不需要刷新 golden：改造之前的每份夹具，要么走的是未改动的降级分支（`stopped`/`error`，或文本不携带 `formatRunResult` 标记的已结算调用），要么捕获的是这次行改造完全不涉及的详情列 ARIA 快照。`science-stop.e2e.ts` 在原有 Stop 场景所用的同一套真实 Runtime/子进程/浏览器栈上新增了三个场景——一次成功结算（内核徽标、完整 stdout）、两次相邻的成功调用折进一个真实生成的组标题、一次真实的内核崩溃渲染出内核退出状态——无需新建一整套夹具家族即可端到端证明这次改造。八态的完整矩阵（含标记解析失败与运行条目缺失的降级路径）以及组标题的类别/失败计数规则表，在 `ui-science`/`ui-conversation` 里都有单元测试覆盖到逐文件 100%。

延后事项，与 brief 一致：把内存中的 DataFrame 结果提升为产物式行，留待 Notebook/Compute 数据地基阶段；内核退出态上的「重启并重跑」操作不做，以保证重跑始终经由模型/对话发起，而不是一个会破坏轨迹一致性的直连客户端控件。
