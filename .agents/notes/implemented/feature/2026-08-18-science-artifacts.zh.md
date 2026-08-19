# Agent Note: Science artifacts — versioned figures carrying their provenance

Status: implemented

[English](2026-08-18-science-artifacts.md) | 中文

## Problem

Science 第一版早已把每张图存成不可变记录，并在图内维护连续版本号，但没有任何产品界面按这个模型呈现它。转录里每个 `save_chart` 结果渲染成一张自足的卡片，Details 栏渲染一份扁平的当前状态摘要。做分析的人会对同一张图产出很多次修订，今天既看不出两个版本之间改了什么，也回答不了决定一个结果能否被辩护的那个问题：这张图是哪段代码、哪个环境、哪轮对话产生的？

留存日志其实已经回答了这个问题的大部分。`ScienceChartVersion` 带着 `runId`、`toolCallId`、`requestHeaderSeq`、`environmentRevision` 和 `environmentFingerprint`；`ScienceRunIdentity` 带着 `codeSha256`、`scratchKey` 以及同样的调用与请求头引用。这份记录与一个可用的溯源界面之间隔着三道障碍：

- **客户端投影把关联字段过滤掉了。** `clientChart` 和 `clientRun`（`packages/science/science-session/src/projection-value.ts`）把 `toolCallId` 与 `requestHeaderSeq` 当作"授权请求事实"去除。少了它们，浏览器手里有图也有转录，却无法把两者连起来。
- **没有任何一层采集包清单。** `ScienceInterpreterIdentity` 记录 `languageVersion`、`condaHistorySha256` 和 `bindingFingerprint`，但没有任何字段记录环境里实际装了哪些包，因此环境记录说不出这次分析跑在什么之上。
- **Details 条目无法贡献头部控件，转录行也无法打开 Details 栏。** `DetailsPanel` 独占一个固定的标题加关闭头部，而 `ToolCallViewProps` 不带 `openDetailsView` —— 这个能力今天只存在于 `ConversationHeaderActionOwnerProps`。

## Decision

给日志里已经存在的概念命名。**Science artifact** 是一张逻辑图，由 `chartId` 标识；**artifact version** 是一条 `ScienceChartVersion`。不需要新的留存事件，也不需要新的领域概念：artifact 已经在日志里，连续版本化且不可变。

每个 artifact 版本可解析出一个由四部分组成的**溯源包**：

| 部分 | 来源 | 路径 |
|---|---|---|
| 代码 | `run_code` 调用参数 | 图的 `runId` → 运行的 `toolCallId` → 转录里的工具节点 |
| 执行日志 | `run_code` 调用结果（stdout/stderr 正文、退出码） | 同一个工具节点；留存字节数与截断标志来自投影 |
| 对话 | 发出该调用的那一轮 | 图/运行的 `toolCallId` 与 `requestHeaderSeq` |
| 环境 | 图的 `environmentRevision` 处的 `science/environment-bound` | 投影，外加下述包清单（另见 Consequences 中的"环境历史只有单一版本"） |

这个分工是刻意的，而且本来就是对的：**留存的 Science 事件存身份与摘要，转录存正文。** `codeSha256` 是留存锚点，被渲染的那份副本是工具调用。因此溯源不需要为代码和日志新增任何 Host 读取路由，只需要补上让这个连接成立的投影字段。

### 解锁改动（Host 侧）

**在投影上恢复关联字段。** `ScienceClientChartVersion` 与 `ScienceClientRun` 增加 `toolCallId` 和 `requestHeaderSeq`。二者都是浏览器本来就持有的会话日志身份 —— 转录的工具节点用同一个 `CallId` 作键，`requestHeaderSeq` 指向客户端本来就收到的 `request/header` 事件。它们不属于投影过滤器存在的目的所要去除的那类事实（Host 路径、可执行文件、完整指纹、自由文本失败原因），而过滤器当前的宽度让溯源根本无法成立。`clientChart`/`clientRun` 的文档注释随字段一同更新。

`ScienceClientRunIdentity` 还增加 `codeSha256`，完整透出而不截断为预览。溯源视图下文的"代码"部分需要这个留存摘要作为锚点，而与 `environmentFingerprint` 不同，代码摘要不携带任何 Host 基础设施事实 —— 它是对同一条转录调用在解析后已经逐字复述过的源代码文本求的摘要。`projection-schema.ts` 的运行身份校验器随之增加匹配的完整长度十六进制检查。

**采集包清单。** `science-runtime/environment.ts` 已经在受限沙箱下对配置前缀执行探测（`runProbe`、`probeArgv`、`confineProbe`），并用 `kind: 'version' | 'utf8'` 区分。增加 `'packages'`：

- Python：`python -m pip list --format=json` —— 报告解释器自己看到的内容，不依赖前缀之外的任何东西。
- R：用 `Rscript -e` 执行 `installed.packages()[, c("Package", "Version")]` 并以 TSV 打印。**只用 base R** —— `jsonlite` 不保证存在于用户环境，探测不能依赖它。

新的 `SciencePackage { name, version }` 列表以 `packages` 落在 `ScienceInterpreterIdentity` 上，同时新增 `packagesSha256`（对排序后完整清单的稳定摘要）与 `packagesTruncated`。由于身份事实在非 `available` 绑定上是 `Partial` 的，失败的观测天然不带清单也不需要哨兵值 —— 现有的诚实能力记录形状本来就是对的。

清单在完整保留值已知的那一点设界：一个经校验的 Runtime `Config` 字段限制条目数，另一个限制总字节数；超过任一上限即置 `packagesTruncated`，而摘要仍覆盖截断前的完整清单。上限随部署而变（基因组学环境不同于教学环境），因此它是可从 cordis.yml 修改的 `Config` 字段，而不是 `DEFAULT_*` 常量。

第三个上限管的是探测本身，先于任一留存上限生效：`environment.ts` 里的 `PACKAGES_PROBE_MAX_BYTES`（8 MiB）限制包清单探测的原始子进程捕获量。与两个留存上限不同，这一个是固定值，不是 `Config` 字段。它并不完全落进"禁止在插件里硬编码可调参数"规则为固定值保留的那几类——协议常量、外部规范、安全不变量——因此诚实的理由是先例：它沿用这个包 `execution.ts` 里既有的固定上限 `MAX_OUTPUT_BYTES`，那是子进程捕获的既有固定上限，用来防范失控的子进程，而不是表达某种部署策略。两个留存上限随部署而变，是因为运维方到底想保留多少清单是一个真实的运维选择；捕获上限没有这样一条轴——它唯一的作用是在解析与截断发生之前限制原始子进程能产生多少数据，其取值被特意设得远高于 `MAX_PACKAGES_MAX_BYTES`（最高的可配置留存上限），因此任何落在可配置上限之内的清单，即使算上 JSON/TSV 格式化开销，在捕获阶段也绝不会丢失。想要更小留存清单的运维方仍然可以设置 `packagesMaxBytes`；捕获上限对这个选择是不可见的。

`bindingFingerprint` 保持现有输入不变。把包摘要折进去会悄悄重新定义"同一个绑定"的含义并重设现有漂移行为的键；`packagesSha256` 单独记录，好让未来的漂移规则把它当作一个显式决定来消费。

客户端投影原样透出 `packages`、`packagesTruncated` 和 `packagesSha256` 预览 —— 包名与版本不携带任何 Host 路径，因此 `clientInterpreter` 不需要新的脱敏。

**打开两个客户端接缝。**（PR2）`packages/client/ui-conversation`：

- 声明 `conversation.details.header.actions`：一个由 `DetailsPanel` 在标题与自有关闭按钮之间渲染的键控列表槽，以 Details 条目 id 为键，因此只渲染当前活动条目的控件。关闭控件仍归面板所有；条目贡献自己的按钮。
- 给 `ToolCallOwnerProps` 增加 `openDetailsView`——它是 `ui-tool` 的 `tool.call.toolview` owner share，而不是 `ui-conversation` 的类型——使转录行能够选中一个 Details 条目并打开该栏。这个能力、这个 owner 和这次 store 写入，正是 `ConversationHeaderActionOwnerProps` 已经在用的那一套；它们顺着既有的渲染路径抵达 `ToolCallOwnerProps`：`ChatNodeOwnerProps`（`ui-conversation`）→ `ChatView`／`ChatNodeSeat` → `ToolCallTree` 的逐调用分发，这正是 `openFile` 与 trajectory 的 `inspect` 回调已经在用来抵达一个既非 `ui-tool` 也非 `ToolCallOwnerProps` 拥有的目标的同一条路径。这是既有契约与既有路径上多一个座位，不是一个新契约——曾考虑过在 `ui-conversation` 的 client service 上暴露这个能力并将其否决（见下），因为按会话选中的 Details 状态是由渲染树按会话解析的、由 slot 声明的 store 状态；渲染路径之外的任何东西都够不到同一个存活实例。

**另外两个可加性 owner-share 字段。** 上面两个接缝打开时都还不存在；二者都是直到 artifact 面板的头部控件与溯源页签需要一条笔记原始两个接缝未覆盖的写入路径时才浮现：

- `DetailsHeaderActionOwnerProps` 增加 `openView: (id: string) => void`。`DetailsPanel` 本就为自己的关闭控件与路由条目分发声明了 `store: chatStore`，因此把 `actions.setView` 暴露给 header-actions 的 owner share 对壳层没有额外代价——这是一个头部控件本无法以其他方式触达的唯一写入能力（切换中间列的 `conversation.view` 标签页，让一个"为所选 X 打开某视图"的控件无需拥有自己的 store 座位）。Artifact 面板的"溯源"按钮是第一个调用者。
- `ConvViewOwnerProps` 增加 `inspectCall: (callId: CallId) => void`——与 chat 自身工具行已经触发的同一个一次性 inspect-并揭示交接（写入目标调用，切换到 trajectory 视图），从 `ConversationSession` 自身的渲染点泛化而来（它本就每次渲染计算一次，并闭包捕获自己的 `store: chatStore` share），因此每个 `conversation.view` 条目都能拿到它，而不只是 chat 的后代工具行。`ChatViewInjected` 去掉了自己私有的同一个闭包；`ChatView.tsx` 无需改动，该值现在经由 `PropsRuntime<'conversation.view'>` 本就合并进来的 owner share 抵达。溯源页签的跳转到对话记录动作是第一个非 chat 调用者。

### Artifact 面板 —— Details 栏

`ScienceDetailsView` 实际上线为一个带页签的 artifact 查看器，而不是本节最初提议的"画廊加版本条"仪表盘。顶部页签条为每个已打开的逻辑图各持一个页签，每个页签在所派发内容之上带一条面板内工具条（标题、跨该图全部留存版本的版本步进器、溯源/下载/最大化/关闭页签控件）。没有任何页签打开时，面板显示一个着陆视图——每张逻辑图的最新版本（打开其一即打开其页签），外加下方的最新 Outcome。本节曾提议作为常驻面板区块的环境条与 Runs 列表，最终完全没有以常驻区块的形式上线；环境事实只存在于选中某个 artifact 后的溯源下钻视图（见下文）里，且仅限于该 artifact 那次运行的范围。选择状态是一个开放页签模型（`selection-store.ts`），而不是本节最初提议的 `{ chartId, version } | null`。上线设计、其 store 不变式与权衡过的替代方案见 [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.md)。

### 溯源视图 —— conversation 视图页签

溯源最终没有以本节提议的、按会话动态注册的独立 `conversation.view` 页签（id 为 `science.provenance`）形式上线，而是变成了面板内下钻：artifact 工具条上的"溯源"控件把当前页签的视图切换为一个带面包屑的溯源视图，内含四个子页签——代码、执行日志、Messages（本提案里原称"对话"，现已改名）、环境——一次只显示一个部分。每个子页签解析的都是本节指定的同一个溯源部分：留存的代码摘要连同转录里的参数原文、执行日志正文加投影里留存的字节数与截断标志、一个跳转到对话记录的动作（现在经由 `DetailsViewOwnerProps.inspectCall`——`conversation.details.view` 条目的 owner share——而不是本节最初为 `conversation.view` 条目提议的 `ConvViewOwnerProps.inspectCall`；后者依然存在，依然服务于普通的 `conversation.view` 条目，只是 Science 已经不再是其中之一），以及以 JSON 展示的环境版本，其被取代版本的回退行为与本节所述一致。完整决策见 [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.md)。

### 转录行

`ScienceChartRow` 不再是整张卡片，而变成导航：一行紧凑内容，含小缩略图、`logicalName`、`v{n}` 和标题。激活它会在 ui-science 的 store 里选中该 artifact 版本并调用 `openDetailsView('science')`。缩略图上一个悬浮显现的控件直接打开灯箱，因此全屏查看仍是一次操作。运行中、失败、中断和无法解析的回退保持现有文本行为。

### 改动涉及的文件

- `packages/science/science-session/src/` —— `types.ts`（客户端图/运行的关联字段、`ScienceClientRunIdentity` 上的 `codeSha256`、`SciencePackage`、清单字段）、`projection-value.ts`（`clientChart`、`clientRun`、`clientInterpreter`）、`projection-schema.ts`（关联字段与 `codeSha256` 校验）、`fold.ts` 解码器、`domain.ts` 事件载荷。
- `packages/science/science-runtime/src/` —— `environment.ts`（`packages` 探测及其上限）、`config.ts`（两个上限字段）。
- `packages/client/ui-conversation/src/client/` —— `contract/slots.ts`（`conversation.details.header.actions` 键控槽与 `ChatNodeOwnerProps`／`ChatViewInjected.openDetailsView`；新增的可加性字段 `DetailsHeaderActionOwnerProps.openView` 与 `ConvViewOwnerProps.inspectCall`）、`skeleton/DetailsPanel.tsx`、`skeleton/DetailsPanel.module.css`、`skeleton/ConversationSession.tsx`（`inspectCall` 闭包从 `ChatViewInjected` 迁移到这里）、`apply.ts`、`chat/ChatView.tsx`、`chat/ChatNodeSeat.tsx`。
- `packages/client/ui-tool/src/client/` —— `contract/slots.ts`（`ToolCallOwnerProps.openDetailsView`）、`tool/ToolCallTree.tsx`。
- `packages/client/ui-science/src/client/` —— `ScienceDetailsView.tsx`（artifact 面板）、`ScienceChartRow.tsx`（紧凑行）、新增 `ScienceArtifactHeaderActions.tsx`（面板的两个头部控件）、新增 `ScienceProvenanceView.tsx`、新增 `selection-store.ts`、`index.ts` 注册（含由会话列表驱动的溯源标签页门控）、`locales.ts`。
- 以上每个包的 README，在同一次改动内更新。

## Alternatives considered

**引入 `science/artifact-*` 事件族。** 否决：`ScienceChartVersion` 本身就是 artifact 版本 —— 不可变、连续版本化、携带附件。并行事件族会重复身份、割裂回放，并逼出一条"哪份记录说了算"的规则。

**按运行而不是按环境绑定采集包清单。** 否决：清单是绑定的属性，而运行频繁且短暂，按运行采集会为完全相同的数据成倍增加留存字节与探测延迟。代价是会话中途安装的包直到下次绑定才可见；`condaHistorySha256` 已经会在那一刻捕获 conda 层面的变动。

**用 `conda list --json` 拿 build string。** 否决：它要求在配置前缀之外定位 conda 可执行文件，给一条目前自足的探测路径引入外部依赖和新的沙箱面。`pip list` 与 `installed.packages()` 报告的是解释器自己看到的内容。代价是清单带包名与版本但没有 build string。

**在 R 探测里用 `jsonlite`。** 否决：它是一个普通 CRAN 包，用户环境未必安装，而一个在合法环境上失败的溯源探测比解析 TSV 更糟。

**把探测捕获上限也做成第三个 `Config` 字段。** 否决：两个留存上限之所以随部署而变，是因为运维方确实想保留不同数量的清单；捕获上限没有可比的轴——它只需要安全地高于最高的可配置留存上限，使一份合法清单不会在捕获阶段因格式化开销而被截断。把它暴露成 `Config` 字段，等于提供一个除了"足够大以至于从不截断"之外没有合法取值的旋钮，这不是 `Config` 字段该服务的那种可配置性——那会是一个套着审批流程外壳的 `DEFAULT_*` 常量。`MAX_OUTPUT_BYTES` 已经为运行输出固定了同类上限；把这一个按同样方式设定，让两处捕获上限保持一致。

**把 `packagesSha256` 折进 `bindingFingerprint`。** 暂时否决：那会让"同一个绑定"的含义悄悄改变，并把漂移检测的键当作新增采集的副作用重设。单独记录摘要，把它留成未来的显式决定。

**把 artifact 选择放进 `ChatStoreState`。** 否决：这是只有 ui-science 会读的 Science 领域浏览状态，而 ui-conversation 持有那个 store 是为了它自己的骨架所派发的状态。

**在 `ui-conversation` 的 client service（`ctx.conversation`）上暴露"打开详情"，而不是放进 `ToolCallOwnerProps`。** 否决：当前活动的 Details 条目是 slot 声明的 `chatStore` 里的按会话状态，slots 引擎在自己的注册表内部按（store handle、会话）这一对解析出唯一的存活实例，只经由某个 slot 注册在渲染时收到的 `store`／`actions` share 交给组件。`ConversationController` 是一个根作用域单例，位于这条渲染路径之外；要从它那里够到同一个存活实例，就得再加一条 service 侧的 store 解析路径，重复注册表本已拥有的东西，而这一切只是为了打开一个仅 `ui-tool` 渲染路径需要的座位。`openFile` 与 trajectory 的 `inspect` 回调出于同样的理由已经走 `ChatNodeOwnerProps` → `ToolCallOwnerProps` 这条路径：它们的目标（打开工作区、切换 trajectory 视图）归别处所有，owner-props 链正是够到它而不引入跨包值导入的认可路径。

**在 Details 栏而不是视图页签里渲染溯源。** 否决：代码、执行日志和环境 JSON 块都很宽，而 Details 栏被钳制在 520px（`DETAILS_MAX`）并会在让位链中自动关闭。中间栏是唯一放得下的界面。

**保留转录行的整张图卡片。** 否决：一旦面板带版本渲染 artifact，这张卡片就是把对话撑开的重复内容。行剩下的职责是导航。

**溯源页签也照搬 `ScienceHeaderAction` 自己那套模式，对非 Science 会话渲染 null 来设门。** 拿到渲染树之后被否决：`conversation.session.header.actions` 是一份各自独立控件的列表，每个都可以自主决定渲染空——因此一个渲染 null 的 header action 确实不留任何痕迹。`conversation.view` 不同——它的标签行是从 `views.list()` 投影而来，这是一份在任何条目自身组件运行之前、由渲染点（`ConversationSessionHeader`）读取的静态注册台账；一个渲染 null 的条目依然占着一行台账，依然会为每个非 Science 会话产出一个可点击、带标签的空标签页。验收标准里的"不存在"指的就是台账那一行本身消失。也曾考虑过给 `views.list()`／注册选项扩展一个通用的按会话可见性谓词，同样被否决：那是一处只服务当前一个调用方的 `ui-slots`／`ui-conversation` 框架改动，而包内本地的动态注册（`ctx.sessions.list.subscribe`，与本文件其他 `ctx.effect` 作用域的注册对称）能达到同样的效果，且不扩大任何一个包的公开面。

**把新增的清单字段设为可选，让既有日志仍能回放。** 在预发布立场下否决：可选的留存字段会携带本仓库明确不作出的兼容承诺，而必填字段会在解码处大声失败，而不是悄悄产生一条说不出自己有哪些包的环境记录。

## Consequences

- 图的客户端投影带有 `toolCallId` 与 `requestHeaderSeq`，浏览器无需任何额外 Host 路由即可从对话快照解析出该图的 `run_code` 调用。
- 绑定环境时为每个可用解释器记录包清单，每条含包名与版本，并含一个对排序后完整清单的摘要和一个截断标志；不可用的解释器不记录清单。
- 两个清单上限都是可从 cordis.yml 设置的、经校验的 `Config` 字段；超过任一上限的清单被截断、被标记，且摘要仍覆盖截断前的完整值。
- `bindingFingerprint` 与同一环境在本次改动之前产生的值逐字节一致。
- Details 栏被重新设计为上文所述的带页签 artifact 查看器，而不是本节最初提议的"画廊加版本条"，让人可以把任意逻辑图打开在各自的页签里，并通过工具条的版本步进器逐个走过它的全部留存版本。
- 本笔记为 `ui-conversation` 新增的键控 `conversation.details.header.actions` 槽仍是一项通用的框架能力，但 Science 自己对它的注册——面板原来的溯源/放大头部控件——后来被删除，改由 artifact 工具条自身承载这些控件；面板自有的关闭控件不变。
- 激活转录中的图行会打开或激活该图对应页签，并精确定位到该行所指的版本；缩略图上的悬浮控件打开灯箱且不打开该栏。
- 溯源包——为选中版本准备的代码、执行日志、对话轮次和环境 JSON——最终以上文所述的面板内下钻形式渲染，而不是本节最初提议的独立 `conversation.view` 页签，并为每个单独不可用的部分（含一个投影已不再保留的、被取代的环境版本）以及为落在已加载对话窗口之外的运行，各渲染一个独立的、有文档的状态。
- artifact 查看器及其溯源下钻在 Standard 会话或自定义的非 Science 会话中不存在，因为 `conversation.details.view` 条目本身就不会在 `science` preset 之外注册。
- 释放 ui-science 与 ui-conversation 的 fiber 会移除本笔记及其后续查看器面板重设计所新增的每一项注册。
- **既有 Science 会话日志确实无法回放了。** 必填的清单字段意味着本次改动之前写入的 `science/environment-bound` 载荷会在其解码器处失败。预发布立场认可这一点（后端拒绝旧的落盘格式）；未编写迁移，任何保留的、包含该事件的 fixture 或已录制快照都在同一次改动内被重录。
- **探测成本落在环境绑定上。** 对一个大型 R 库执行 `installed.packages()` 并不瞬时，而绑定处在会话首次运行的路径上。探测运行在既有的限制与超时之下，因此失败模式是有界的延迟或一次不可用绑定，而不是挂起。
- **被截断的清单是较弱的溯源记录。** 摘要仍覆盖完整清单，因此截断可被察觉，但一份被截断的列表无法被回放成一个环境。
- **代码与执行日志依赖已加载的对话历史。** 它们来自转录，而客户端按窗口加载转录（`loadOlder`）。运行早于已加载窗口的 artifact 会渲染为不可用直至加载更多历史；留存摘要与字节数仍然可见，因此该状态是可读的而不是空的。
- **环境历史只有单一版本。** `ScienceProjection.environment`（及其客户端投影）只保留最新绑定，而不是逐版本保留，因此一旦绑定已经更迭，溯源下钻的"环境"部分就无法展示某个较旧 artifact 运行时所用的确切环境——它转而报告仍然保留的版本号与该运行自身的指纹前缀，而不是那个 JSON 块。逐版本的环境历史仍是一项更大、需要单独立项的改动（留存事件本已携带每个版本；投影需要保留的不只是最新一个）。
- **`SessionEventMap` 载荷改动波及了两个 SDK。** TypeScript 与 Python SDK 的期望输出，以及无密钥快照（`apps/web/tests/snapshots/science-preset`、`examples/headless-agent/tests/snapshots/science-tools`）在同一次改动内一并更新；`pnpm run test` 一个都不覆盖。
