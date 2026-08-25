# @deepseek-ai/dsh-client-ui-science

[English](README.md) | 中文

Science 工具结果、设置、文件与结论入口、artifact 预览和逐轮 artifact 轨迹的浏览器展示层。它只消费冻结的会话数据和 client-safe Science projections；持久化写入通过 Host Remote 完成。

## 会话记录行与逐轮轨迹

`run_python`、`run_r`、`annotate_artifact` 与 `publish_outcome` 注册 keyed `tool.call.toolview` 条目。Run 结果保留完整状态、stdout 与 stderr，并根据带标签的展示元数据追加精确版本文件引用。Artifact 结果渲染一个紧凑文件引用，Outcome 结果渲染不可变 revision 与证据。

每个产出过 artifact 的 assistant 轮次都会获得一个 `conversation.chat.turnTail` 条目：`本轮产出 N 个文件 · 查看轨迹`。展开后严格显示三行紧凑内容：前一条用户要求、结构化执行与文件计数、带版本的 run 与文件操作。窄宽度下，长文本在所在行内截断。Run 操作展开从持久化 call 与 Science projection 解析出的代码、输出和环境 revision；artifact 操作打开精确版本。完整 assistant 回答就在相邻聊天内容中，因此这里不重复模型散文。

## 选择状态存储

`selection-store.ts` 只保存 artifact 查看状态：有序精确版本标签页、活跃 artifact id 和 lightbox 状态。Viewer 与会话记录中的文件引用接收同一个 store handle，因此由同一按会话实例协调。不存在 viewer mode 或 provenance subtab 状态。

## Artifact viewer

`science` Details 条目是对象状态 viewer。其常驻内容仅限 artifact 预览、精确版本历史、纯用户备注，以及跳到产出所选版本的 assistant 消息。它没有差异或溯源视图，也没有常驻轨迹或语义泳道控件。

预览按持久化 media type 分派：图片使用 `MessageImage`；CSV 使用有界可排序表格（`ArtifactTable.tsx`）；JSON 使用 `JsonTree`；Vega-Lite JSON 使用内置 SVG renderer；Markdown 使用 `MarkdownText`；纯文本使用有界 `<pre>`。CSV 表格最多渲染 `MAX_ARTIFACT_TABLE_ROWS`（500）行，非 CSV 文本在尝试 JSON 解析或 `<pre>` 渲染之前会被限制到 `MAX_ARTIFACT_TEXT_CHARACTERS`（100,000）个字符——二者都是固定的呈现层上限（`format.ts`），与部署自身的附件字节上限无关；被截断的渲染会显示一条“仅显示前 N 项”的提示。CSV 解析（`csv.ts`）是手写的、类 RFC4180 解析器，而非一个依赖：这是对自动捕获或模型标注文件的只读预览，从不涉及任意不受信任的上传，`packages/client` 中也没有会需要共享表格组件的第二个消费方。下载通过按会话附件 loader 解析所选版本。图片放大复用共享 lightbox。

Vega-Lite 结构选择与栅格区域可带可选目标备注加入主 composer。直接 Vega-Lite 样式编辑通过 `scienceEdits.commitStyleEdit` 把完整 JSON working copy 提交为 human-edit 版本。Viewer 不包含独立的模型指令输入框。

所有 artifact media type 统一支持备注。Viewer 按 logical artifact 展示备注及其 add-event sequence、写入时版本和时间戳；用户通过 `scienceEdits.addArtifactNote` 与 `scienceEdits.removeArtifactNote` 添加纯文本或删除活跃备注。备注与 model-visible Science 状态分开投影，绝不进入 prompt。

没有活跃标签页时，文件库展示每个 logical artifact 的最新版本。Outcome 保留在独立的 `science-outcomes` Details 路由。

## 设置与外壳组装

`science-runtime` 设置卡片通过 `ctx.settingsScope` 编辑固定 `science` profile 的 Python 与 R prefix；两条路径都是 secret role，已保存值不会回显到输入框。卡片根据 Host 提供的 snapshot 区分已生效、待重启和未配置状态。

文件 toggle 的位置由校验后的 Host `toggleScope` 决定：`session` 注册 Science 会话 utility 与空白 Science 会话 handoff，`global` 为桌面组装注册一个无条件 page utility。Sidebar destinations、composer 目标 chips 与 kernel 状态仍只对 Science 会话显示。

## 模型体验

无，因为 artifact 预览、版本选择、下载、直接样式编辑、备注与逐轮轨迹都不增加模型输入；只有通过主 composer 提交已暂存 artifact targets 才会创建现有结构化 `science-edit` user message。

#### KV Cache 影响

这些纯用户侧界面不会改变模型请求，因此不会使模型侧 KV cache 失效或扩展它。

## 已知限制与暂缓事项

- 备注支持添加与删除，不支持编辑。
- 逐轮轨迹只报告持久化事件中已有的事实；安装包与人工操作必须先有权威事件才能出现。
- **超过渲染上限的文本 artifact 无法在原地完整浏览** — `MAX_ARTIFACT_TABLE_ROWS`/`MAX_ARTIFACT_TEXT_CHARACTERS`（`format.ts`）会在整个内容进入 DOM 之前截断表格/文本渲染，因此表格排序与 JSON 解析都只作用于已显示的前缀，而被截断的 `.vl.json` 几乎必然无法重新解析，所以超限的 Vega-Lite artifact 显示为截断的原始文本而非图表；下载仍会取回完整的持久化字节。
- 确定性 PNG/PDF 导出以及 R/Python prompt 或工具优化不属于本包范围。
