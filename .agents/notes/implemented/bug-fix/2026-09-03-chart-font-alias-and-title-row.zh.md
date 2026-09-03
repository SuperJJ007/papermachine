# Agent Note: 图表编辑的字体别名解析、提交失败详情与无标题图表的标题控件

Status: implemented

[English](2026-09-03-chart-font-alias-and-title-row.md) | 中文

## 问题

`set_font` 使用通用字族（matplotlib rcParams 别名 `sans-serif`/`serif`/`monospace`，R grid 设备通用族 `sans`/`serif`/`mono`）时总是以 `font_not_found` 失败。`matplotlib.font_manager.FontProperties(family=<裸字符串>)` 在 `family` 是构造函数唯一参数时会走 fontconfig 模式串解析路径,而该语法拒绝 `"sans-serif"` 中的连字符;图表编辑面板的字体控件在只改字号时会重新发送当前字族(尚无字体元素时默认发送 `"sans-serif"`),因此纯改字号的编辑也会失败。R 的 `.dsh_font_available` 要求 `systemfonts::match_fonts()` 解析出的字族名与请求字符串完全相等,而 macOS 上以 CoreText 为后端的 `systemfonts` 对通用别名也会失败——它会静默替换为系统默认字体而不报错,导致解析结果永远不会与别名字面相等。

一次提交(`applyChartEdit`)如果没有解析成功任何一个请求操作,会抛出单一的通用信息"No chart edit operation resolved an addressable element",丢弃了每个操作各自的失败原因(`set_font` 的 `font_not_found`,其他操作的 `element_not_found`)——而对同一组操作做预览时,这些原因本会逐操作报告出来。

当内核尚未提取出标题元素时,图表编辑面板完全不渲染标题控件——两个适配器都只在文字存在时才提取 `title` 目录元素——即便 `set_title` 配合 `axes: null` 会无条件创建一个标题。无标题的图表因此无法从面板添加标题。

## 决策

### 通用字族别名可以正常解析,不再失败

`chart_matplotlib.py` 的 `set_font` 现在调用 `FontProperties(family=[family])`。单元素列表使构造函数避开 fontconfig 模式串路径——该路径只在 `family` 是不带其他关键字参数的裸 `str` 时触发——因此带有模式语法会拒绝的标点符号的通用别名,仍能通过 `rcParams['font.<alias>']` 正常解析。`except` 从 `Exception` 收窄为 `ValueError`:一旦模式串路径不可达,`findfont(..., fallback_to_default=False)` 对无法解析的字族抛出 `ValueError` 就是这处调用唯一还可能抛出的异常,因此该调用点上真正的程序错误会照常向外传播,而不会被误标为 `font_not_found`。

`chart_ggplot2.R` 的 `.dsh_font_available` 现在把 `"sans"`、`"serif"`、`"mono"`(R grid 设备的通用字族)以及 `"sans-serif"`、`"monospace"`(共享面板字体控件所使用的 CSS 风格拼写,与产出图表的语言无关)一律视为可用,完全跳过 `systemfonts::match_fonts()` 的一致性检查。R 的 grid/cairo 设备把这五个都当作内置通用字族接受,渲染它们从不报错;但 macOS 上的 `systemfonts` 会把未匹配或通用字族静默替换为系统默认字体而不报错,导致其解析结果永远不会与请求字面相等——此前这曾拒绝了全部五个别名。

### 整体提交失败会给出每个操作各自的原因

`ScienceRuntime` 的提交路径(`packages/science/science-runtime/src/index.ts` 中的 `performChartEdit`)现在从每个失败操作的从 1 开始的序号、操作名和失败原因拼出 `CHART_ELEMENT_NOT_FOUND` 的信息——`No chart edit operation applied: op 1 set_font — font_not_found`——而不是一句通用话。`edit-message.ts` 的 `translateChartRuntimeError` 本就原样转发 `error.message`,因此那里无需改动映射。图表编辑面板的 `style.failed` 渲染(整体请求被拒绝的路径)与 `panel.failedOp` 渲染(部分失败的路径)现在共用一对 `localizeFailureReason`/`localizeFailureMessage` 辅助函数,把唯一稳定的机器可读原因(`font_not_found`)替换成既有的 `panel.fontNotFound` 本地化字符串,使 `set_font` 单独失败时,无论是全部操作都失败(提交)还是只有部分失败(预览),文案读起来一致。

### 图表编辑面板始终提供标题控件

`ScienceChartEditPanel.tsx` 的 `directEditRows` 现在会在目录中不存在 `title` 类元素时,合成一行无标题的 `title` 行(`id: 'title', axes: null, current: ''`),暂存与真实标题行相同的 `set_title`/`axes: null` 操作。它无需经过通用排序即固定排在最前——`title` 本就领先于 `DIRECT_EDIT_ROW_ORDER`,而 `axes: null` 也已经排在任何有 axes 的行之前——因此其位置与真实标题行会出现的位置一致。由于它不指代任何目录元素,该行的引用 `+`/`−` 按钮被完全隐藏(`referenceable: false`),而不是留着让它指向 store 无法匹配的目标。

`x_label`/`y_label` 没有得到同样处理。`set_axis_label` 的 `axes: null` 会把同一段文字广播到所有子图(`chart_matplotlib.py` 中的 `_selected_axes` 对 `null` 索引返回全部 axes),这与 `set_title` 的 `axes: null` 不同——后者走的是完全不同的分支,只创建一个 figure 级标题。要正确合成无标题的坐标轴标签行,需要为每行选定具体的 axes 索引,或每个 axes 各出一行——这是真正的额外设计工作,不是标题修复的简单镜像——因此本次改动没有覆盖它们。

## 考虑过的替代方案

**保留 matplotlib 的 `family=family`(裸字符串)调用,只对带连字符的名称单独处理。** 已拒绝:构造函数走 fontconfig 模式串路径是由参数形态(不带其他关键字参数的裸 `str`)触发的,与取值无关,因此未来任何带有模式特殊字符的别名都会重现同样的失败。传入单元素列表从根本上避开了整套模式语法,而不是逐一枚举名称。

**保留 R `.dsh_font_available` 的严格一致性检查,只对 `"sans"`/`"serif"`/`"mono"` 单独处理,与既有的 `systemfonts` 不可用兜底分支保持一致。** 已拒绝:共享面板的字体控件无论产出图表的语言是什么,都会把 CSS 风格的 `"sans-serif"`/`"monospace"` 拼写当作自己的默认值暂存(`fontInitial` 的 `'sans-serif'` 兜底),因此若要与图表语言无关地修复,就需要同时覆盖两种拼写,否则同一缺陷会在任何尚无字体元素的 R 图表上重现。

**把结构化的 `failedOps` 一路传递到抛出的提交错误中,而不是把它们格式化进错误文字。** 在本次改动范围内已拒绝:这会需要拓宽 `ScienceRuntimeError`、`ScienceEditError` 的 RPC 边界以及客户端的 `RpcError` 结构以携带结构化细节。选定的信息格式(`op <n> <操作名> — <原因>`)刻意做到无歧义,使面板的单词元替换无需完整的结构化传递也能可靠工作。

**把 `CHART_ELEMENT_NOT_FOUND` 按失败原因拆分成多个错误码。** 已拒绝:一次提交可能同时混合元素解析失败和字体解析失败,而 `translateChartRuntimeError` 已经把两个既有错误码同样映射到 `CHART_OP_INVALID`,新拆分出的错误码对现有任何消费者都不会带来可区分的行为。

**像 `title` 一样合成 `x_label`/`y_label` 行。** 在此已拒绝:与 `set_title` 不同,`set_axis_label` 的 `axes: null` 意味着"所有 axes"——这是真实的行为广播——因此无标题坐标轴标签的合成需要按 axes 选定目标,而本次改动没有做这项设计。

## 影响

`set_font` 配合通用别名——面板自身的默认值及其 `FONT_FAMILIES` 列表——现在两种语言都能成功;重新发送当前字族的纯改字号编辑不再失败。整体提交被拒绝时会给出哪个操作失败及原因,与同一组操作做预览时已报告的细节一致;运行时 README 记录了这段更丰富的信息。图表编辑面板可以为任何图表——无论原本有没有标题——从同一行添加标题;`x_label`/`y_label` 在内核未提取出对应元素时仍无法添加,因此使用默认坐标轴标签的无标题图表,这两类元素仍需通过代码编辑。
