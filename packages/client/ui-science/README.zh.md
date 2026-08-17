# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

浏览器端的持久化 `save_chart` 与 `publish_outcome` 会话记录行展示，外加 Science 设置卡片。会话记录行注册按键分派的 `tool.call.toolview` 条目，只消费冻结的工具调用/结果数据、客户端安全的 `science` 会话投影，以及会话界面拥有的会话附件加载器；它们既不创建 Science 事实，也不通过独立路由加载附件字节。设置卡片注册按键分派的 `settings.plugin.item` 条目，通过绑定的 settings scope 读写固定 `science` 配置档案的 Conda 前缀。

## 图表行

带受支持标签化展示元数据的已完成 `save_chart` 结果会渲染逻辑图表名、版本、标题、可选说明、来源运行、尺寸与字节数。该行把持久化 `ImageAttachmentRef` 交给共享 `MessageImage` 原子组件，后者负责加载、重试、预览、键盘激活、灯箱显示与焦点恢复。运行中、失败、中断、缺失、格式错误或不受支持的展示值都会保留可读的文本回退。

## Outcome 行

已完成的 `publish_outcome` 结果会渲染其自身不可变的版本、标题、Markdown 摘要，以及运行/图表/消息证据标签。精确图表引用通过当前客户端安全的 `science` 投影解析，并复用同一附件加载器显示缩略图。投影、图表版本或附件缺失时，发布文本与证据标识仍保持可见，并明确报告图像不可用。

## 设置卡片

该卡片以固定的 `science-runtime` 命名空间——`@deepseek-ai/dsh-science-runtime/with-settings` 注册的命名空间，而非某个包名或产品 id——为键注册进 `settings.plugin.item`，因此只要 Host 服务了该命名空间它就会出现，否则不留任何痕迹，也无需任何导航条目或 Host 侧改动。它通过 `ctx.settingsScope` 绑定该命名空间，只编辑 `['science', 'pythonPrefix']` 与 `['science', 'rPrefix']`（分节根部本身就是配置档案映射，以固定的 `science` 配置档案 id 寻址，而非包一层 `profiles` 字段），加上用于显式移除覆盖动作的 `unsetPath(['science'])`；没有任何代码路径会写入分节根部。两个字段都是 `role('secret')`，其存储值从不出现在任何 settings 响应里——卡片从 `SettingsScopeSnapshot.secrets` 获知逐字段的存在状态，并且从不把已存储的路径回显进输入框。留空的替换输入是空操作，每一次成功变更都会标注"需要重启"，与 Runtime 只在重启时生效的解析方式一致。该卡片拥有自己的暂存与 revision 设栅，而不复用**插件配置**分区的卡片外观或暂存表单模型——bundle 纯净度门禁禁止将它们作为值导入。

## 组装

请在 `@deepseek-ai/dsh-client-ui-tool`、`@deepseek-ai/dsh-client-ui-attachment`、客户端 locale/runtime 包、`@deepseek-ai/dsh-client-ui-settings`（`ctx.settingsScope`），以及会暴露 `science` 会话投影的 Host 组合之后加载本浏览器插件。已发布的 Web bundle 会以有意留空的配置档案映射挂载 `@deepseek-ai/dsh-science-runtime/with-settings`，因此在有人填写 Python/R Conda 前缀并重启 Host 之前，卡片会以未配置的 `science` 配置档案出现；CLI 与 headless bundle 保留各自显式的 Runtime 组合，不显示该卡片。

## 模型体验

无。会话记录行只渲染已经记录的工具结果，设置卡片编辑的是部署配置；两者都不改变模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider request。

## 已知限制与暂缓事项

- **仅 PNG 展示** — Science v1 只保存 PNG 图表，因此本包没有通用图表规范或非图像渲染器。
- **没有独立附件缓存** — 附件生命周期、授权、重试与 object URL 回收仍由会话加载器和附件 UI 拥有。
- **仅一个固定配置档案、两个字段** — 卡片只编辑内置 `science` 配置档案的 `pythonPrefix`/`rPrefix`，因为内置 preset 是当前唯一的产品消费方；其他部署配置档案 id 仍是文件/配置层面的事，不由浏览器管理。
- **没有发现、探测或即时生效** — 卡片从不列出、探测或校验某个 Conda 环境，也没有文件系统选择器或即时生效控件；已存储的前缀在 Host 重启完成绑定之前始终不可见。
