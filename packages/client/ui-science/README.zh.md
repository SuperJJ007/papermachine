# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

浏览器端的持久化 `save_chart` 与 `publish_outcome` 会话记录行展示、Science 设置卡片、图表面板（带溯源信息的多版本图表），以及用于在会话记录之外查看它们的 session-header action、溯源视图标签页与 Details header 控件。会话记录行注册按键分派的 `tool.call.toolview` 条目，只消费冻结的工具调用/结果数据、客户端安全的 `science` 会话投影，以及会话界面拥有的会话附件加载器；它们既不创建 Science 事实，也不通过独立路由加载附件字节。设置卡片注册按键分派的 `settings.plugin.item` 条目，通过绑定的 settings scope 读写固定 `science` 配置档案的 Conda 前缀。header action、图表面板、其 header 控件与溯源标签页注册进 `@deepseek-ai/dsh-client-ui-conversation` 的 `conversation.session.header.actions`、`conversation.details.view`、`conversation.details.header.actions` 与 `conversation.view` 座位；它们都只是同一客户端安全投影加一个本包内部选择状态存储的纯读取方，都不构建第二套投影读取器、图表历史、Outcome 编辑器或附件缓存。

## 图表行

带受支持标签化展示元数据的已完成 `save_chart` 结果会渲染为一个紧凑的导航行：小缩略图、逻辑图表名、版本徽章与标题——不再包含说明、来源运行或字节数，这些现在都在图表面板的详情视图中。激活该行（缩略图以外的任意位置）会在共享选择状态存储中选中该确切图表版本，并在 `science` 条目上打开 Details 列。缩略图上悬停显现的控件会直接打开共享灯箱，因此全屏查看不必打开该列。运行中、失败、中断、缺失、格式错误或不受支持的展示值都会保留可读的文本回退。

## Outcome 行

已完成的 `publish_outcome` 结果会渲染其自身不可变的版本、标题、Markdown 摘要，以及运行/图表/消息证据标签。精确图表引用通过当前客户端安全的 `science` 投影解析，并复用同一附件加载器显示缩略图。投影、图表版本或附件缺失时，发布文本与证据标识仍保持可见，并明确报告图像不可用。

## 设置卡片

该卡片以固定的 `science-runtime` 命名空间——`@deepseek-ai/dsh-science-runtime/with-settings` 注册的命名空间，而非某个包名或产品 id——为键注册进 `settings.plugin.item`，因此只要 Host 服务了该命名空间它就会出现，否则不留任何痕迹，也无需任何导航条目或 Host 侧改动。它通过 `ctx.settingsScope` 绑定该命名空间，只编辑 `['science', 'pythonPrefix']` 与 `['science', 'rPrefix']`（分节根部本身就是配置档案映射，以固定的 `science` 配置档案 id 寻址，而非包一层 `profiles` 字段），加上用于显式移除覆盖动作的 `unsetPath(['science'])`；没有任何代码路径会写入分节根部。两个字段都是 `role('secret')`，其存储值从不出现在任何 settings 响应里——卡片从 `SettingsScopeSnapshot.secrets` 获知逐字段的存在状态，并且从不把已存储的路径回显进输入框。留空的替换输入是空操作，每一次成功变更都会标注"需要重启"，与 Runtime 只在重启时生效的解析方式一致。该卡片拥有自己的暂存与 revision 设栅，而不是把**插件配置**分区的卡片外观或暂存表单模型作为值导入——bundle 纯净度门禁禁止这样做。它的外观构建在 `@deepseek-ai/dsh-client-ui-primitives` 的共享原子之上——两个前缀字段用 `Input`，Configured/Not configured 徽章用 `Pill`，保存/放弃修改/移除覆盖都用 `Button`——而不是未加样式的原生元素，因此卡片与应用自身的控件保持一致；只有卡片容器的边框/圆角/背景，以及默认收起的 header/chevron 布局——没有任何原生组件提供这两者——才是本包自己的 CSS。收起时，可访问性树里只有 header（名称、描述与展开开关）——每个字段、提示与操作按钮都只在展开后才会渲染，与每个兄弟卡片的行为及可访问名称的措辞保持一致。

## 选择状态存储

图表面板、会话记录行、面板的 header 控件与溯源视图共享同一个本包私有的、按会话划分的存储（`selection-store.ts`），保存 `{ chartId, version } | null` 与一个 `lightboxOpen` 标记。该存储是 Science 专属的查看状态，因此由 ui-science 直接持有，而不是加进 `@deepseek-ai/dsh-client-ui-conversation` 的 `ChatStoreState`——后者由该包持有，服务于其自身骨架分派的状态。每个插件 fiber 创建一个句柄，作为 `store:` 注册座位传给需要它的每一个条目，因此让这四个界面就同一实时实例达成一致的是框架自身的"句柄 × 会话"缓存，而不是它们之间的一次值导入。

## 图表面板（Details 条目）

面板以 id `science` 注册进 `conversation.details.view`，标签来自 `science` 命名空间的已注册文案。它保持只读，渲染数据来自 chart/Outcome 行读取的同一个 `science` Session 投影，加上上面的选择状态存储：

- **环境概览** — 配置档案、版本号、状态，以及逐语言的 capability、版本、指纹预览与包数量（绝不包含 Host path、可执行文件、完整指纹，或超出名称/版本的包构建细节）。
- **运行** — 有序的 run 状态/历史。
- **图表图库** — 每个 logical chart 一条，展示其最新版本的缩略图、逻辑名、标题与版本徽章；选中一条会切换到图表详情。
- **图表详情** — 放大显示所选版本，附标题、说明、来源运行与尺寸，以及一条**版本导览条**，列出该图表的每一个持久化版本（`v1…vN`）；选择导览条中的一项会切换所渲染的版本，而不离开详情视图。返回图库控件会清空选择。
- **Outcome** — 带证据引用的最新 Outcome。

在第一条 Science 事件之前，面板显示已选择的 preset 与一个未绑定状态。缺失投影支持、图表附件不可用、Runtime 绑定失败（没有 environment revision，或其 `status` 不是 `'applied'`）、没有 run、没有图表、选择已失效（图表已不存在，此时会回退到图库）、没有 Outcome，各自渲染不同的文案——没有任何状态会仅凭已配置的前缀就显示为"Runtime 就绪"。

图表缩略图通过本包自己的会话作用域加载器（`science-attachment-loader.ts`）解析，而非会话记录行使用的、由会话界面拥有的那个：Details 条目的宿主份额不携带任何内容（`DetailsViewOwnerProps`），因此它直接调用 `ISession.readAttachment`，并把返回的字节转换为 `data:` URI，不使用 `Map`，也不持有 `URL.createObjectURL` 句柄——没有任何东西需要在会话释放时回收，也不会在会话加载器自己的缓存之外再添加一套缓存。

## Details header 控件与 header action

header action 注册进 `conversation.session.header.actions`，除非当前 Session summary 的 `agentPreset` 指向内置 `science` preset，否则什么都不渲染——Standard 或自定义的非 Science Session 不会显示该 action，也没有任何 Session 会自动打开 Details 列。激活它只会调用宿主提供的 `openDetailsView('science')`；它不会打开自己的面板。

图表面板通过按键分派的 `conversation.details.header.actions` 座位（键为 `science`）贡献两个控件，由 `DetailsPanel` 渲染在标题与其自身的关闭按钮之间：**溯源**通过宿主提供的 `openView` 打开 `science.provenance` 视图标签页（见下文）；**放大**通过写入选择状态存储的 `lightboxOpen` 标记打开共享灯箱——header 与面板自身的大图位于两棵互为兄弟的渲染树中，因此无法直接触达那张图片的私有打开状态。两个控件都只在选中了某个图表版本时才渲染；当前处于活跃状态的其他 Details 条目不会贡献任何控件。

## 溯源视图

一个 `conversation.view` 标签页，id 为 `science.provenance`，标签文案来自 `science` 命名空间。由于视图标签页的列表成员关系是框架不会按会话过滤的静态注册台账，本包自行随当前会话 `agentPreset` 的变化注册与销毁该条目——只在 Science 会话为当前会话时存在，否则整体缺失（而非仅仅渲染为空）——采用与 `ScienceHeaderAction` 相同的判断依据，通过一个普通的 `ctx.sessions.list` 订阅（不涉及 React）与本包的其他注册一起完成协调。

针对选择状态存储中当前的图表版本，它渲染四个部分，每个部分在自身数据缺失时都独立报告不可用：

1. **代码** — 来源运行的 `code` 参数，通过该运行的 `toolCallId` 从会话快照中解析得到，并展示持久化的 `codeSha256` 作为锚点（与环境指纹不同，这里展示完整值——它是对同一次调用已经逐字复述过的源代码文本求的摘要，而不是 Host 基础设施事实）。
2. **执行日志** — 来自同一调用已完成结果的 stdout/stderr 文本，并在旁展示投影中持久化的字节数与截断标记，作为权威度量——即使会话记录尚未加载也可见。
3. **对话** — 请求序号与开始时间，附带一个跳转到会话记录的动作，复用既有的 `ConvViewOwnerProps.inspectCall` 交接机制（写入一次性 inspect 目标，切换到 trajectory 视图），而非新增第二条通道。
4. **环境** — 当投影仍保留该确切版本时，以 JSON 形式展示该环境版本（配置档案、版本号、状态、时间戳，以及逐语言的 capability/版本/指纹预览与包清单）；若该版本已被取代（投影只保留最新版本），则单独报告这一状态，并展示该运行自身的指纹预览作为仍然保留的事实。

没有选择，或所选图表已不可解析时，视图会报告该状态，而不渲染任何部分。

## 组装

请在 `@deepseek-ai/dsh-client-ui-tool`、`@deepseek-ai/dsh-client-ui-attachment`、`@deepseek-ai/dsh-client-ui-conversation`（header action、Details 条目、Details header 控件与视图标签页所在的座位）、客户端 locale/runtime 包、`@deepseek-ai/dsh-client-ui-settings`（`ctx.settingsScope`），以及会暴露 `science` 会话投影的 Host 组合之后加载本浏览器插件。已发布的 Web bundle 会以有意留空的配置档案映射挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，因此在有人填写 Python/R Conda 前缀并重启 Host 之前，卡片会以未配置的 `science` 配置档案出现；CLI 与 headless bundle 保留各自显式的 Runtime 组合，不显示该卡片。

## 模型体验

无。会话记录行只渲染已经记录的工具结果，设置卡片编辑的是部署配置，header action、图表面板与溯源视图只读取当前状态的 Session 投影与会话快照；均不改变模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider request。

## 已知限制与暂缓事项

- **仅 PNG 展示** — Science v1 只保存 PNG 图表，因此本包没有通用图表规范或非图像渲染器。
- **没有独立附件缓存** — 会话记录行的缩略图沿用由会话界面拥有的会话附件加载器（宿主提供的 `loadImage`），其生命周期、重试与 object URL 回收仍归那里所有。Details 条目的缩略图通过自己无状态的 `data:` URI 转换、经由 `ISession.readAttachment` 解析（没有任何宿主份额携带加载器可用）；两条路径都不添加自己的持久化 Map 缓存。
- **仅一个固定配置档案、两个字段** — 卡片只编辑内置 `science` 配置档案的 `pythonPrefix`/`rPrefix`，因为内置 preset 是当前唯一的产品消费方；其他部署配置档案 id 仍是文件/配置层面的事，不由浏览器管理。
- **没有发现、探测或即时生效** — 卡片从不列出、探测或校验某个 Conda 环境，也没有文件系统选择器或即时生效控件；已存储的前缀在 Host 重启完成绑定之前始终不可见。
- **环境历史仅保留单一版本** — `science` 投影只保留最新的一次环境绑定，因此一旦绑定发生变化，溯源视图的"环境"部分就无法展示某个较旧图表运行时的确切版本；它会转而报告仍然保留的版本号与指纹预览。
