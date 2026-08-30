# Agent Note：以活图对象和操作日志实现 Science 图表编辑

Status: proposed

[English](2026-08-28-science-live-figure-editing.md) | 中文

## 问题

Science 需要一种图表编辑方式：保留研究者已经使用的绘图库，允许用户从显示的 PNG 中选择有意义的图表元素，并能在原始内核退出后重现编辑结果。已移除的 spec-first 设计把 Vega-Lite 变成第二套图表语法，要求 Python 与 R 以不同方式编写该语法，也无法表达所有 matplotlib 或 ggplot2 图表。浏览器渲染的内容还与捕获的科学 artifact 字节不同。

当图表或图片没有可寻址结构时，raster 区域选择仍有价值；但矩形本身无法识别标题、轴标签、series、图例或 annotation。因此，直接编辑必须利用原生绘图库的结构，同时不能把内核里的可变对象当作持久状态。

## 提案

图表底座采用活图对象加持久操作日志。模型继续编写 matplotlib 或 ggplot2 代码，并在 `SCIENCE_ARTIFACT_DIR` 下保存 `image/png`。run 结束时，内核 adapter 将每个被拦截的 `savefig` 或 `ggsave` 路径与其活图对象关联，抽取封闭元素目录与像素命中表，并把该投影存到 artifact version。屏幕显示的就是捕获的 PNG。

三项所有权决策约束这一底座。每次保存沿用 matplotlib 或 ggplot2 选定的 DPI；Runtime 不把不同绘图库统一到同一种 export density。只有被拦截的 `Figure.savefig()`/`pyplot.savefig()` 与 `ggsave()` 调用才会登记，因此 R device-level 输出与 base graphics 保持普通 PNG。`chart` 投影属于 `science/artifact-saved` 与 Session projection，而不属于 project artifact store；后者继续持久化原样图片字节与普通版本元数据。

直接编辑会先要求当前语言 kernel 把经过校验的操作施加到已登记活图对象。登记缺失时触发私有恢复：Runtime 以物化输入重新执行确切源 run，重放该 version 的先前操作日志，再施加新操作，且不记录一条额外 scientific run。随后按保存时的 DPI 导出，重新抽取目录与命中表，并追加一个 `origin: 'human-edit'` artifact version；其操作日志只按重放顺序包含成功操作。部分 target 失败会连同请求索引返回；没有任何操作成功的请求会被拒绝。图对象、恢复 run 与 runtime 私有句柄都不进入 session log 或模型命名空间。

持久 artifact record 增加可选 `chart` 字段：

```ts ignore-check
interface ScienceChartState {
  runtime: 'matplotlib' | 'ggplot2'
  figureKey: string
  png: { width: number; height: number; dpi: number }
  elements: readonly ScienceChartElement[]
  hitmap: readonly ScienceChartHit[]
  hitmapStatus: 'ok' | 'unavailable'
  ops: readonly ScienceChartOp[]
}
```

该字段由 `science/artifact-saved` 携带并投影给 viewer。按照 pre-release 策略，`SESSION_FORMAT_VERSION` 保持 `0`。通过不受支持路径生成的 PNG，包括 base R `plot()` 与绕过 `ggsave()` 的 R graphics device，不带 `chart` 字段并保留普通 raster 行为。若 raster 尺寸不匹配，已抽取 elements 会保留，但 `hitmapStatus` 设为 `'unavailable'` 且 `hitmap` 必须为空；consumer 绝不使用 pixel grid 与保存 PNG 不一致的命中坐标。

直接编辑不会排入一次模型回合。当模型之后看到同一个 artifact 时，`get_science_state` 与 artifact receipt 会把累计编辑数量以及每项操作的名称和元素 target 连同确切 version 一起公开，同时省略文本、颜色、字号、坐标及其他参数值。变更图型、facet 或源数据等结构性修改仍由模型修改代码。代码变化后，已存操作按元素身份重新校验；无法再解析目标的操作会被报告，而不是猜测新目标。

Viewer 会把经过 debounce 的待定直接操作送入同一条 warm-or-replay 路径预览。预览只在私有 run scratch 中写请求、结果与 PNG 文件；即使全部待定操作都失败，它仍返回重新抽取的 chart、PNG 字节与带索引的失败，并且不追加 artifact version 或 Session event。精确模型引用绝不使用预览路径。Save 会再次应用累计操作，在没有操作成功解析时拒绝，并且是浏览器中唯一会追加 human-edit version 的动作；Discard 恢复已持久化 version 的 PNG。

### 封闭元素目录

版本一只识别以下 13 类元素：`title`、`subtitle`、`x_label`、`y_label`、`tick_labels`、`legend`、`series[<label>]`、`grid`、`axis_range`、`axis_scale`、`figure_size`、`font` 与 `annotation`。subplot 与 facet 使用 `axes[i]` 前缀。没有 label 的拟合线、逐 mark 命中、单个图例色块与 ggplot2 facet 局部颜色在版本一中不可寻址。

### 封闭操作集合

封闭操作集合为 `set_title`、`set_axis_label`、`set_legend_position`、`toggle_grid` 与 `set_font`。两个适配器都为全部五项定义确定性行为，只有标题／副标题、x/y 轴标签、图例、网格与字体元素暴露直接控件。其余每个已抽取元素都保持可见，并可作为精确引用发送给模型。字体元素只公开当前字体族与字号，绝不枚举已安装字体族。字体操作接受有界的自由文本字体族与字号；runtime 无法精确解析字体族时以 `font_not_found` 失败，且不改变图对象，也绝不修改 matplotlib 的全局 `rcParams`。

这项区分是一条持久产品规则：只有两个适配器都实现确定性行为，且共享 codec 对操作参数与当前值设定边界时，图表元素才获得直接控件；其他元素一律只可引用。只有在两个适配器与共享 codec 定义同一行为，并同时更新 viewer、Runtime 验收与模型引用校验后，封闭操作集合才可扩张。

当一张图没有图级标题（`fig.suptitle()`；ggplot2 没有对应机制）且只有一个 axes 时，两个 runtime 都把该唯一 axes 的标题抽取为 `kind: 'title'`；matplotlib 只在存在 suptitle 或多个 axes 时才把 axes 标题保留为 `kind: 'subtitle'`，与 ggplot2 自身标题（始终为 `kind: 'title'`）保持一致。

`set_legend_position` 作用于 matplotlib 自身的 `loc` 词汇表（`best`、`right`、四个角、三条边、`center`），并原样传给 `Axes.legend(loc=...)`。ggplot2 的 `theme(legend.position = ...)` 只接受 `right`/`left`/`top`/`bottom`/`inside`/`none`；未映射的字符串会静默移除图例而不是报错，因此 ggplot2 adapter 不把枚举值原样传下去，而是确定性地映射：`best`/`right` 变为 `legend.position = "right"`；每个角、边、居中取值变为 `legend.position = "inside"`，并设置 `legend.position.inside`/`legend.justification.inside` 为对应的归一化坐标。未映射的取值会使操作失败，而不是丢弃图例；抽取会把 inside 图例的坐标读回其 `current` 值。

### 同一 artifact 多版本在 viewer 中的展示

在 Details 中，显示标题只出现在标签页与文件库卡片；查看器工具栏不显示标题。标题采用 artifact 最新已知的既定标题，在版本间步进时保持不变。Composer chip 与轮末产物卡保留同一标题规则。溯源下钻按其所描述的确切版本命名。

模型用 `read_image` 自检一次渲染并在同一轮内、在整理标题之前重新渲染一个修复版，会在一轮内产生两个字节确实不同的版本；前一个在用户看来像是紧随其后那个的多余重复。修法是展示，而不是版本模型：当同一 artifact 中存在一个更晚的版本，与它同时共享授权 turn 与产生该版本的 session——即客户端 artifact projection 上的 `turn` 字段（由服务端从已折叠的 `tool/call` 事实解析得出，而非由客户端从原始 session 事件反推）与 `producerSessionId` 字段，使续作 session 的 turn 1 不会与另一个 session 的 turn 1 被误判为同一轮——且它本身不是 human-edit 保存时，该版本就是同轮中间稿。版本步进器默认只在非折叠版本间步进，背后有一个可展开的入口临时把折叠版本纳入其中；文件库卡片与轮末产物卡本就只展示最新版本，不受影响。

### Runtime 所有权

Runtime 拥有 `(runId, capture-relative path)` 到图对象句柄的私有映射。内核 wire 增加显式的 extract 与 apply 操作，而不暴露任意对象访问。Artifact store 拥有持久 PNG 字节；Science session 拥有目录、命中表与操作记录；viewer 只渲染 projection 并提交有类型的操作。既有 `artifact_inputs`、`edit_of`、版本谱系、raster-region 消息、声明式 raster 捕获、artifact 文件库与 provenance 全部保留。

## 试验证据

Adapter 试验在 matplotlib 中找到 13 类目录元素中的 12 类，在 ggplot2 中找到 11 类。像素命中测试在 matplotlib 试验中有 88.6% 选中预期元素，在 ggplot2 试验中为 89.5%。五种直接操作都改变了预期输出。重建图对象并重放操作日志后，确定性 fixture 的像素差为零。

Warm 操作往返耗时：matplotlib 约 12 ms，ggplot2 为 65–96 ms。Cold 恢复耗时：matplotlib 约 370 ms，ggplot2 约 570 ms。这些结果支持活对象存在时的即时预览，以及对象不存在时的有界重放；它们不是产品延迟保证。

## 曾考虑的替代方案

- **Vega-Lite spec-first 图表。** 否决并移除。它引入第二套绘图语法，在 Python 与 R 上形成不对称的 authoring，排除该语法无法表达的图表，增加大型浏览器 renderer，并显示 SVG 而不是捕获的 PNG。原生绘图对象已经暴露所需语义，因此其结构化选择与样式 editor 不足以证明并行管线的价值。
- **基于 Flint 的 `plot` 工具。** 三轮试验后否决。专用工具会替换普通 matplotlib 与 ggplot2 authoring，却无法消除拦截已保存图、抽取原生元素或重放源代码的需要。活对象设计直接从用户已经熟悉的库获得控制能力。
- **Plotly。** 否决。它会增加另一套绘图语法和 runtime，无法覆盖现有 matplotlib 与 ggplot2 代码，并仍需为不支持的科学 geometry 保留独立路径。
- **持久化活图对象。** 否决，因为 Python 与 R 对象属于进程本地、可变，并不是稳定 session 格式。Source、input、确定性 adapter 与有类型操作日志才是持久恢复输入。
- **只保留 raster 矩形。** 否决其作为主要图表 editor，因为矩形没有语义身份，也无法可靠跨越代码重跑。区域选择仍是不具可寻址性的 PNG 的 fallback。

## 验收标准

- 通过受支持保存路径捕获的 matplotlib 与 ggplot2 PNG 携带有界元素目录、命中表与空操作日志；不受支持的 PNG 在没有 chart metadata 时仍然有效。
- 13 类元素拥有共享 codec 与严格校验；五种直接操作在两个受支持 runtime 中都有匹配的 adapter coverage。
- 应用操作会创建带确切 parent 与累计操作的新 PNG artifact version；直接编辑绝不修改既有 version。
- 内核退出后，以确切 source run、物化输入与操作日志恢复；确定性 fixture 重现编辑后 PNG 时像素差为零。
- Viewer 列出每个已抽取图表元素，只为标题／副标题、x/y 轴标签、图例、网格与字体暴露控件和预览，让其余元素只可引用，并且只在用户显式操作后保存新 version。
- 模型进行结构性修改时收到确切当前 version 与操作上下文；重新校验后失效的操作会被报告。
- Keyless snapshot 覆盖 extract、apply、replay、receipt 与模型可见操作上下文；浏览器 coverage 固定选择与保存行为。

## 风险

- Monkey-patch 保存路径可能遗漏通过不支持 API 保存或已经关闭的图对象。这些 artifact 必须降级为普通 PNG，不能声称可寻址。
- 绘图库发布版本可能改变私有对象细节。Adapter 应尽量使用受维护的公共 API，并在无法生成目录或执行操作时大声失败。
- 当 label 重复或被删除时，跨源代码变化的元素身份具有启发性。重新校验必须拒绝歧义，不能把操作施加到一个看似合理但不同的元素。
- 命中表每个 version 可能占用数 KB，需要显式上限。过粗会降低选择准确率，过细会增加 session 与 projection 成本。
- Replay 会再次执行模型编写的 source。它必须复用既有 confined runtime、确切物化输入、timeout 策略与持久 run accounting，不能成为未记录的捷径。
- Matplotlib 与 ggplot2 并不对称支持所有操作。在两个 adapter 都定义确定性行为，并同时变更共享 codec、viewer、验收覆盖与精确模型引用校验之前，封闭操作集合不能扩张。
