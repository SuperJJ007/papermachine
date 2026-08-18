# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

浏览器端的持久化 `save_chart` 与 `publish_outcome` 会话记录行展示、Science 设置卡片、artifact viewer（带每版本溯源下钻的标签式图像查看器），以及打开它的 session-header action。会话记录行注册按键分派的 `tool.call.toolview` 条目，只消费冻结的工具调用/结果数据、客户端安全的 `science` 会话投影，以及会话界面拥有的会话附件加载器；它们既不创建 Science 事实，也不通过独立路由加载附件字节。设置卡片注册按键分派的 `settings.plugin.item` 条目，通过绑定的 settings scope 读写固定 `science` 配置档案的 Conda 前缀。header action 与 artifact viewer 注册进 `@deepseek-ai/dsh-client-ui-conversation` 的 `conversation.session.header.actions` 与 `conversation.details.view` 座位；两者都只是同一客户端安全投影加一个本包内部选择状态存储的纯读取方，都不构建第二套投影读取器、图表历史或 Outcome 编辑器。

## 图表行

带受支持标签化展示元数据的已完成 `save_chart` 结果会渲染为一个紧凑的导航行：小缩略图、逻辑图表名、版本徽章与标题——不再包含说明、来源运行或字节数，这些现在都在 artifact viewer 内容工具栏中。激活该行（缩略图以外的任意位置）会在共享选择状态存储中打开（或激活，定位到该确切版本）该图表的标签页，并在 `science` 条目上打开 Details 列。缩略图上悬停显现的控件会直接打开共享灯箱，因此全屏查看不必打开该列。运行中、失败、中断、缺失、格式错误或不受支持的展示值都会保留可读的文本回退。

## Outcome 行

已完成的 `publish_outcome` 结果会渲染其自身不可变的版本、标题、Markdown 摘要，以及运行/图表/消息证据标签。精确图表引用通过当前客户端安全的 `science` 投影解析，并复用同一附件加载器显示缩略图。投影、图表版本或附件缺失时，发布文本与证据标识仍保持可见，并明确报告图像不可用。

## 设置卡片

该卡片以固定的 `science-runtime` 命名空间——`@deepseek-ai/dsh-science-runtime/with-settings` 注册的命名空间，而非某个包名或产品 id——为键注册进 `settings.plugin.item`，因此只要 Host 服务了该命名空间它就会出现，否则不留任何痕迹，也无需任何导航条目或 Host 侧改动。它通过 `ctx.settingsScope` 绑定该命名空间，只编辑 `['science', 'pythonPrefix']` 与 `['science', 'rPrefix']`（分节根部本身就是配置档案映射，以固定的 `science` 配置档案 id 寻址，而非包一层 `profiles` 字段），加上用于显式移除覆盖动作的 `unsetPath(['science'])`；没有任何代码路径会写入分节根部。两个字段都是 `role('secret')`，其存储值从不出现在任何 settings 响应里——卡片从 `SettingsScopeSnapshot.secrets` 获知逐字段的存在状态，并且从不把已存储的路径回显进输入框。留空的替换输入是空操作，每一次成功变更都会标注"需要重启"，与 Runtime 只在重启时生效的解析方式一致。该卡片拥有自己的暂存与 revision 设栅，而不是把**插件配置**分区的卡片外观或暂存表单模型作为值导入——bundle 纯净度门禁禁止这样做。它的外观构建在 `@deepseek-ai/dsh-client-ui-primitives` 的共享原子之上——两个前缀字段用 `Input`，Configured/Not configured 徽章用 `Pill`，保存/放弃修改/移除覆盖都用 `Button`——而不是未加样式的原生元素，因此卡片与应用自身的控件保持一致；只有卡片容器的边框/圆角/背景，以及默认收起的 header/chevron 布局——没有任何原生组件提供这两者——才是本包自己的 CSS。收起时，可访问性树里只有 header（名称、描述与展开开关）——每个字段、提示与操作按钮都只在展开后才会渲染，与每个兄弟卡片的行为及可访问名称的措辞保持一致。

## 选择状态存储

artifact viewer 与会话记录行共享同一个本包私有的、按会话划分的存储（`selection-store.ts`），保存开放标签页模型：一个有序的 `openArtifacts` 列表（每个 logical chart 一条，每条携带该标签页当前展示的持久化版本）、`activeChartId`、活跃标签页的 `view`（`'content' | 'provenance'`）、下钻上一次展示的 `provenanceSubTab`，以及一个 `lightboxOpen` 标记。活跃标签页所展示的版本本身并不单独成字段——它总是从 `openArtifacts` 中匹配的条目读取，因此一个标签页所展示的版本只有一处记录。`view` 与 `provenanceSubTab` 是单一字段，而非按标签页各自持有：切换到另一个标签页总会回到 `'content'`，而上一次选中的溯源子标签页作为一个跨标签页保留的偏好设置。该存储是 Science 专属的查看状态，因此由 ui-science 直接持有，而不是加进 `@deepseek-ai/dsh-client-ui-conversation` 的 `ChatStoreState`——后者由该包持有，服务于其自身骨架分派的状态。每个插件 fiber 创建一个句柄，作为 `store:` 注册座位传给需要它的每一个条目，因此让会话记录行与 viewer 就同一实时实例达成一致的是框架自身的"句柄 × 会话"缓存，而不是它们之间的一次值导入；正是这同一个按会话划分的缓存，让一个会话已打开的标签页在 Details 列关闭再重新打开之间保持不变，与 `@deepseek-ai/dsh-client-ui-layout` 自身的"切换会话时强制关闭"行为无关。

## Artifact viewer（Details 条目）

viewer 以 id `science` 注册进 `conversation.details.view`，标签来自 `science` 命名空间的已注册文案。它保持只读，渲染数据来自 chart/Outcome 行读取的同一个 `science` Session 投影，加上上面的选择状态存储：

- **标签栏** — 每个已打开的 artifact（logical chart）一个标签页，各自可独立关闭；点击一条会话记录中的图表行会打开或激活该图表的标签页，并定位到该行所指的确切版本。没有任何标签页打开时，viewer 显示其落地视图，而非一条空标签栏。
- **工具栏** — 面向活跃标签页的内容视图：图表的标题与逻辑名、一个版本步进器（‹ v*n* ›，在两侧相邻的持久化版本间切换），以及溯源/下载/放大/关闭标签页控件。下载通过同一个会话作用域加载器解析持久化字节，并经由一个临时的 `data:` URI 锚点触发浏览器保存；放大打开共享灯箱（第二个、由存储驱动的 `ImageLightbox` 实例，因为工具栏与内容图片自身的私有点击展开状态是兄弟关系，而非其祖先）。
- **内容** — 按图表的持久化附件媒体类型分派；如今每一种已接受的 `ImageMediaType` 都经由同一个图像渲染器渲染（大图、说明、来源运行与尺寸）。这个分派正是后续非图像 artifact 阶段要扩展的接缝：新增一种媒体类型只需新增一个分支，无需改动标签栏或工具栏。
- **溯源下钻** — 距内容视图一次工具栏点击之遥（见下文）；一条面包屑可返回内容视图。
- **落地视图** — 在没有标签页打开时显示：每个 logical chart 最新版本组成的图库（打开其中一个即打开其标签页），以及带证据引用的最新 Outcome，展示在图库下方——保持可达但处于次要位置，因为它不像图表那样携带需要导览的版本历史或溯源信息。

在第一条 Science 事件之前，viewer 显示一个未绑定状态；当会话摘要携带 preset 时一并显示所选的 preset。缺失投影支持、图表附件不可用、失效标签页（指向投影已无法解析的图表/版本——在正常交互中不可达，因为标签页只会从一次已解析的选择打开，这里只是为防御一个被破坏的存储状态而设），以及没有 Outcome，各自渲染不同的文案。

**设计说明——原仪表盘中的事实去了哪里。** 常驻的环境概览（配置档案、版本号、逐语言 capability/版本/指纹/包数量）与运行列表已经移除；它们不会以任何形式的会话级面板小节重新出现。环境相关的事实只存在于溯源下钻的"环境"子标签页中，作用域是某一个 artifact 的运行——与溯源下钻一直以来的行为相同（JSON 展示加已被取代版本的回退，见下文），如今按已打开的 artifact 各自可达，而不是重复出现在一条常驻概览中。没有任何会话级的"环境未生效"替代提示：该提示专属于已删除的概览小节，而一个没有任何 artifact 打开的会话也没有什么可供下钻。早于该概览存在的两条顶层文案——缺失投影支持与未绑定状态——与它无关，保持不变。Outcome 小节保持可达，但迁移到落地视图而非拥有自己的伪标签页，因为（与图表不同）它没有需要导览的版本历史或溯源信息——落地视图的一个小节不需要额外的外观开销，而会话记录中 `publish_outcome` 行本身仍是定位某个具体 Outcome 版本证据的首选方式。

图表缩略图与内容通过本包自己的会话作用域加载器（`science-attachment-loader.ts`）解析，而非会话记录行使用的、由会话界面拥有的那个：Details 条目的宿主份额只携带 Details 座位自身的 `inspectCall`（见下文），因此它直接调用 `ISession.readAttachment`，并把返回的字节转换为 `data:` URI，不使用 `Map`，也不持有 `URL.createObjectURL` 句柄——没有任何东西需要在会话释放时回收，也不会在会话加载器自己的缓存之外再添加一套缓存。

## Session-header action

header action 注册进 `conversation.session.header.actions`，除非当前 Session summary 的 `agentPreset` 指向内置 `science` preset，否则什么都不渲染——Standard 或自定义的非 Science Session 不会显示该 action，也没有任何 Session 会自动打开 Details 列。激活它只会调用宿主提供的 `openDetailsView('science')`；它不会打开自己的面板。

## 溯源下钻

从 artifact viewer 的工具栏进入（不是一个独立的 `conversation.view` 标签页，也不是一个按键分派的 `conversation.details.header.actions` 条目）：一条面包屑（`<图表标题> › 溯源`），其根节点点击后返回内容视图，下方是针对活跃标签页已解析的 chart/run 的四个子标签页：

1. **代码** — 来源运行的 `code` 参数，通过该运行的 `toolCallId` 从会话快照中解析得到，并展示持久化的 `codeSha256` 作为锚点（与环境指纹不同，这里展示完整值——它是对同一次调用已经逐字复述过的源代码文本求的摘要，而不是 Host 基础设施事实）。
2. **执行日志** — 来自同一调用已完成结果的 stdout/stderr 文本，并在旁展示投影中持久化的字节数与截断标记，作为权威度量——即使会话记录尚未加载也可见。
3. **消息** — 请求序号与开始时间，附带一个跳转到会话记录的动作，复用 Details 座位的 `inspectCall` 宿主回调（写入一次性 inspect 目标，切换到 trajectory 视图）——是一段摘要加一次跳转，而非消息重放。
4. **环境** — 当投影仍保留该确切版本时，以 JSON 形式展示该环境版本（配置档案、版本号、状态、时间戳，以及逐语言的 capability/版本/指纹预览与包清单）；若该版本已被取代（投影只保留最新版本），则单独报告这一状态，并展示该运行自身的指纹预览作为仍然保留的事实。

解析 chart/run 组合（并在其中任一方不再可解析时报告不可用）是 artifact viewer 的职责，不属于本下钻组件——它总是针对一个已经解析好的组合渲染。

## 组装

请在 `@deepseek-ai/dsh-client-ui-tool`、`@deepseek-ai/dsh-client-ui-attachment`、`@deepseek-ai/dsh-client-ui-conversation`（header action 与 Details 条目所在的座位，以及 artifact viewer 溯源下钻复用的 Details 座位 `inspectCall` 宿主回调）、客户端 locale/runtime 包、`@deepseek-ai/dsh-client-ui-settings`（`ctx.settingsScope`），以及会暴露 `science` 会话投影的 Host 组合之后加载本浏览器插件。已发布的 Web bundle 会以有意留空的配置档案映射挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，因此在有人填写 Python/R Conda 前缀并重启 Host 之前，卡片会以未配置的 `science` 配置档案出现；CLI 与 headless bundle 保留各自显式的 Runtime 组合，不显示该卡片。

## 模型体验

无。会话记录行只渲染已经记录的工具结果，设置卡片编辑的是部署配置，header action 与 artifact viewer 只读取当前状态的 Session 投影与会话快照；均不改变模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider request。

## 已知限制与暂缓事项

- **仅 PNG 展示** — Science v1 只保存 PNG 图表，因此内容分派当前唯一的分支就是共享的图像渲染器；后续的非图像 artifact 阶段只需新增一个分支，而不必重新架构 viewer。
- **没有独立附件缓存** — 会话记录行的缩略图沿用由会话界面拥有的会话附件加载器（宿主提供的 `loadImage`），其生命周期、重试与 object URL 回收仍归那里所有。Details 条目的缩略图与内容通过自己无状态的 `data:` URI 转换、经由 `ISession.readAttachment` 解析；两条路径都不添加自己的持久化 Map 缓存。
- **仅一个固定配置档案、两个字段** — 卡片只编辑内置 `science` 配置档案的 `pythonPrefix`/`rPrefix`，因为内置 preset 是当前唯一的产品消费方；其他部署配置档案 id 仍是文件/配置层面的事，不由浏览器管理。
- **没有发现、探测或即时生效** — 卡片从不列出、探测或校验某个 Conda 环境，也没有文件系统选择器或即时生效控件；已存储的前缀在 Host 重启完成绑定之前始终不可见。
- **环境历史仅保留单一版本** — `science` 投影只保留最新的一次环境绑定，因此一旦绑定发生变化，溯源下钻"环境"子标签页就无法展示某个较旧图表运行时的确切版本；它会转而报告仍然保留的版本号与指纹预览。
- **已打开的标签页不做持久化保存** — 选择状态存储只存在于框架按 (句柄, 会话) 划分的缓存里，而非 `localStorage`：在同一次页面加载内，已打开的标签页与当前视图能在 Details 列关闭再重新打开、或会话切换再切回之间保持不变，但无法跨越一次页面刷新。
