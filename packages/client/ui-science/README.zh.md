# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

浏览器端的持久化 `save_chart` 与 `publish_outcome` 会话记录行展示。本插件注册按键分派的 `tool.call.toolview` 条目，只消费冻结的工具调用/结果数据、客户端安全的 `science` 会话投影，以及会话界面拥有的会话附件加载器。它既不创建 Science 事实，也不通过独立路由加载附件字节。

## 图表行

带受支持标签化展示元数据的已完成 `save_chart` 结果会渲染逻辑图表名、版本、标题、可选说明、来源运行、尺寸与字节数。该行把持久化 `ImageAttachmentRef` 交给共享 `MessageImage` 原子组件，后者负责加载、重试、预览、键盘激活、灯箱显示与焦点恢复。运行中、失败、中断、缺失、格式错误或不受支持的展示值都会保留可读的文本回退。

## Outcome 行

已完成的 `publish_outcome` 结果会渲染其自身不可变的版本、标题、Markdown 摘要，以及运行/图表/消息证据标签。精确图表引用通过当前客户端安全的 `science` 投影解析，并复用同一附件加载器显示缩略图。投影、图表版本或附件缺失时，发布文本与证据标识仍保持可见，并明确报告图像不可用。

## 组装

请在 `@deepseek-ai/dsh-client-ui-tool`、`@deepseek-ai/dsh-client-ui-attachment`、客户端 locale/runtime 包，以及会暴露 `science` 会话投影的 Host 组合之后加载本浏览器插件。Web bundle 会挂载它以支持重放，即使基础 Web Host 不挂载 `@deepseek-ai/dsh-science-runtime`；实时创建图表仍需要显式的 Runtime 部署行。

## 模型体验

无。本包只在浏览器中渲染已经记录的工具结果，绝不改变模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider request。

## 已知限制与暂缓事项

- **仅会话记录行** — 当前状态的 Science 详情与设置属于后续产品切片。
- **仅 PNG 展示** — Science v1 只保存 PNG 图表，因此本包没有通用图表规范或非图像渲染器。
- **没有独立附件缓存** — 附件生命周期、授权、重试与 object URL 回收仍由会话加载器和附件 UI 拥有。
