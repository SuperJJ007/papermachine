# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

浏览器端的持久化 `save_chart` 与 `publish_outcome` 会话记录行展示、Science 设置卡片，以及用于在会话记录之外查看当前 Science 状态的 session-header action 与 Details 条目。会话记录行注册按键分派的 `tool.call.toolview` 条目，只消费冻结的工具调用/结果数据、客户端安全的 `science` 会话投影，以及会话界面拥有的会话附件加载器；它们既不创建 Science 事实，也不通过独立路由加载附件字节。设置卡片注册按键分派的 `settings.plugin.item` 条目，通过绑定的 settings scope 读写固定 `science` 配置档案的 Conda 前缀。header action 与 Details 条目注册进 `@deepseek-ai/dsh-client-ui-conversation` 的 `conversation.session.header.actions` 与 `conversation.details.view` 座位；两者都只是同一客户端安全投影的纯读取方，都不构建第二套投影读取器、图表存储、Outcome 编辑器或附件缓存。

## 图表行

带受支持标签化展示元数据的已完成 `save_chart` 结果会渲染逻辑图表名、版本、标题、可选说明、来源运行、尺寸与字节数。该行把持久化 `ImageAttachmentRef` 交给共享 `MessageImage` 原子组件，后者负责加载、重试、预览、键盘激活、灯箱显示与焦点恢复。运行中、失败、中断、缺失、格式错误或不受支持的展示值都会保留可读的文本回退。

## Outcome 行

已完成的 `publish_outcome` 结果会渲染其自身不可变的版本、标题、Markdown 摘要，以及运行/图表/消息证据标签。精确图表引用通过当前客户端安全的 `science` 投影解析，并复用同一附件加载器显示缩略图。投影、图表版本或附件缺失时，发布文本与证据标识仍保持可见，并明确报告图像不可用。

## 设置卡片

该卡片以固定的 `science-runtime` 命名空间——`@deepseek-ai/dsh-science-runtime/with-settings` 注册的命名空间，而非某个包名或产品 id——为键注册进 `settings.plugin.item`，因此只要 Host 服务了该命名空间它就会出现，否则不留任何痕迹，也无需任何导航条目或 Host 侧改动。它通过 `ctx.settingsScope` 绑定该命名空间，只编辑 `['science', 'pythonPrefix']` 与 `['science', 'rPrefix']`（分节根部本身就是配置档案映射，以固定的 `science` 配置档案 id 寻址，而非包一层 `profiles` 字段），加上用于显式移除覆盖动作的 `unsetPath(['science'])`；没有任何代码路径会写入分节根部。两个字段都是 `role('secret')`，其存储值从不出现在任何 settings 响应里——卡片从 `SettingsScopeSnapshot.secrets` 获知逐字段的存在状态，并且从不把已存储的路径回显进输入框。留空的替换输入是空操作，每一次成功变更都会标注"需要重启"，与 Runtime 只在重启时生效的解析方式一致。该卡片拥有自己的暂存与 revision 设栅，而不是把**插件配置**分区的卡片外观或暂存表单模型作为值导入——bundle 纯净度门禁禁止这样做。它的外观构建在 `@deepseek-ai/dsh-client-ui-primitives` 的共享原子之上——两个前缀字段用 `Input`，Configured/Not configured 徽章用 `Pill`，保存/放弃修改/移除覆盖都用 `Button`——而不是未加样式的原生元素，因此卡片与应用自身的控件保持一致；只有卡片容器的边框/圆角/背景，以及默认收起的 header/chevron 布局——没有任何原生组件提供这两者——才是本包自己的 CSS。收起时，可访问性树里只有 header（名称、描述与展开开关）——每个字段、提示与操作按钮都只在展开后才会渲染，与每个兄弟卡片的行为及可访问名称的措辞保持一致。

## Header action 与 Details 条目

header action 注册进 `conversation.session.header.actions`，除非当前 Session summary 的 `agentPreset` 指向内置 `science` preset，否则什么都不渲染——Standard 或自定义的非 Science Session 不会显示该 action，也没有任何 Session 会自动打开 Details 列。激活它只会调用宿主提供的 `openDetailsView('science')`；它不会打开自己的面板。

Details 条目以 id `science` 注册进 `conversation.details.view`，标签来自 `science` 命名空间的已注册文案。它是只读的，渲染的数据来自 chart/Outcome 行读取的同一个 `science` Session 投影：客户端安全的 environment 摘要（配置档案、版本号，以及逐语言的 capability/版本/指纹预览——绝不包含 Host path、可执行文件或完整指纹）、有序的 run 状态/历史、每个 logical chart 的最新已接受版本及其缩略图，以及带证据引用的最新 Outcome。在第一条 Science 事件之前，它显示已选择的 preset 与一个未绑定状态。缺失投影支持（Host 未组装 `science` 投影单元）、图表附件不可用、Runtime 绑定失败（没有 environment revision，或其 `status` 不是 `'applied'`）、没有 run、没有图表、没有 Outcome，各自渲染不同的文案——没有任何状态会仅凭已配置的前缀就显示为"Runtime 就绪"，因为 environment capability 只来自一次持久化的 `'applied'` 绑定。

图表缩略图通过本包自己的会话作用域加载器（`science-attachment-loader.ts`）解析，而非会话记录行使用的、由会话界面拥有的那个：Details 条目的宿主份额不携带任何内容（`DetailsViewOwnerProps`），因此它直接调用 `ISession.readAttachment`，并把返回的字节转换为 `data:` URI，不使用 `Map`，也不持有 `URL.createObjectURL` 句柄——没有任何东西需要在会话释放时回收，也不会在会话加载器自己的缓存之外再添加一套缓存。

## 组装

请在 `@deepseek-ai/dsh-client-ui-tool`、`@deepseek-ai/dsh-client-ui-attachment`、`@deepseek-ai/dsh-client-ui-conversation`（header action 与 Details 条目所在的座位）、客户端 locale/runtime 包、`@deepseek-ai/dsh-client-ui-settings`（`ctx.settingsScope`），以及会暴露 `science` 会话投影的 Host 组合之后加载本浏览器插件。已发布的 Web bundle 会以有意留空的配置档案映射挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，因此在有人填写 Python/R Conda 前缀并重启 Host 之前，卡片会以未配置的 `science` 配置档案出现；CLI 与 headless bundle 保留各自显式的 Runtime 组合，不显示该卡片。

## 模型体验

无。会话记录行只渲染已经记录的工具结果，设置卡片编辑的是部署配置，header action/Details 条目只读取当前状态的 Session 投影；三者都不改变模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider request。

## 已知限制与暂缓事项

- **仅 PNG 展示** — Science v1 只保存 PNG 图表，因此本包没有通用图表规范或非图像渲染器。
- **没有独立附件缓存** — 会话记录行的缩略图沿用由会话界面拥有的会话附件加载器（宿主提供的 `loadImage`），其生命周期、重试与 object URL 回收仍归那里所有。Details 条目的缩略图通过自己无状态的 `data:` URI 转换、经由 `ISession.readAttachment` 解析（没有任何宿主份额携带加载器可用）；两条路径都不添加自己的持久化 Map 缓存。
- **仅一个固定配置档案、两个字段** — 卡片只编辑内置 `science` 配置档案的 `pythonPrefix`/`rPrefix`，因为内置 preset 是当前唯一的产品消费方；其他部署配置档案 id 仍是文件/配置层面的事，不由浏览器管理。
- **没有发现、探测或即时生效** — 卡片从不列出、探测或校验某个 Conda 环境，也没有文件系统选择器或即时生效控件；已存储的前缀在 Host 重启完成绑定之前始终不可见。
