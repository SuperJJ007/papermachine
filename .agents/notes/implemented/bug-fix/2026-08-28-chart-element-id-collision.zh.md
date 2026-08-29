# Agent Note: 图表适配器在命中表提取前去重碰撞的元素 id

Status: implemented

[English](2026-08-28-chart-element-id-collision.md) | 中文

## Problem

一次真实 Science 会话画了一张 matplotlib 分组柱状图,带有十二个 `ax.annotate` 柱值标注,同一会话里还有一张 R ggplot2 图。R 的编辑面板正常出现;Python 的没有出现——保存的 PNG 对应的 artifact 根本不带 `chart` 字段。直接用真实 kernel(mesa Python)跑模型原代码加 `CHART_EXTRACT` 显示 kernel 本身正确提取出了一个 23 元素的合法图表(`runtime: 'matplotlib'`、`bbox_inches='tight'` 下 `hitmapStatus: 'unavailable'`)——适配器与 kernel 协议都没问题。

丢失发生在 host 解码环节。`packages/science/science-runtime/src/index.ts` 的 `extractChartsAfterFinish` 对每个提取出的图表调用 `decodeScienceChartState`,一旦抛错就记一条 warn 日志并把该路径整个从返回的图表 map 里剔除——静默丢弃图表而不是让 run 失败。`science-session/src/codec.ts` 的 chart `superRefine` 在 `elementIds.size !== chart.elements.length`(即两个元素共享同一 id)时抛错。`chart_matplotlib.py` 的 `extract_elements` 用每个标注 artist 自身渲染出的文本构造 id——`"annotation[text:%s]" % text.get_text()[:20]`——对不同 artist 之间的唯一性毫无保证。十二个柱值标注里有两个四舍五入后是完全相同的显示字符串("0.48"),于是两者的 id 都是 `annotation[text:0.48]`,`chart.elements` 出现重复,codec 拒绝整张图表,artifact 丢失 `chart`——而且这个丢弃只是一个私有提取辅助函数内部的 warn 级日志,模型或维护者在任何地方都看不到报错。R 侧的 `chart_ggplot2.R` 用 `layer<N>:<GeomClass>` 构造标注 id,这次会话碰巧没撞上,但存在完全相同的结构性风险——两个标注图层产出同一 geom 类,或者一个 series(`series[<label>]`)碰上两个图例标签被绘图自身的 scale 格式化成相同文本。

codec 的唯一性校验是对的:像素空间命中表靠 id 引用元素,重复 id 会让命中表产生歧义。缺陷在于适配器一开始就可能发出重复 id。

## Decision

`chart_matplotlib.py` 与 `chart_ggplot2.R` 的 `extract_elements` 在返回前,对构建好的元素列表做一次确定性去重:第一个带某个 id 的元素保留原 id;之后每个同 id 的元素按列表顺序追加稳定后缀(`#2`、`#3`……)。`chartElementIdSchema`(codec.ts)只禁止空 id、超过 `MAX_CHART_ELEMENT_ID_LENGTH` 的 id 和控制字符——`#` 是普通合法字符,追加后缀的 id 不需要额外的校验改动。matplotlib 的 `compute_hitmap` 直接基于传入的、已去重的 `elements` 列表构建结果,因此命中表天然引用去重后的 id;R 的 `compute_hitmap` 根本不读 `elements`——它那几个固定的命中 id(`title`、`x_label`、`legend`、按轴的 `grid`……)本就是与元素目录里 `annotation`/`series` id 不同的固定字符串,自身没有碰撞风险。codec 的唯一性与命中引用校验未改动;它们是对的,仍然是执行校验的地方。

## Alternatives considered

**放宽 codec 的唯一性要求(允许同 id 的最后一个元素生效,或丢弃之后的重复项)。** 拒绝:codec 的唯一性不变式正是命中表 id 引用不产生歧义的前提,也是两个适配器都必须满足的唯一执行点;削弱它会静默丢弃目录条目(用户在 PNG 里能看到、但在 `elements` 里永远找不回的标注),而不是把它们全部保留在可区分的 id 下。

**让 id 生成公式本身抗碰撞(哈希完整渲染文本,或始终带上 artist 的索引)。** 拒绝:现有 id(`series[GPT-4 (dv)]`、`annotation[text:0.48]`)已经有明确含义、在完全相同的重跑之间保持稳定,并且被逐字用作模型可见的 `applyChartEdit` API 里的编辑目标(与 `element["label"]` 及 `_artist_for` 的子串查找相匹配);改成哈希或始终带索引会改变所有现有 id 的形态,却没有比"只在真正发生碰撞处追加后缀"带来更多好处,而且哈希或索引本身也不能保证唯一(两个 artist 仍可能哈希相同或落到同一个计算索引),不管怎样都还是需要一次去重处理。

## Consequences

一张本会因元素碰撞而丢失的 matplotlib 或 ggplot2 图表,现在能在唯一 id 下保留完整目录,像其他图表一样获得编辑面板,而不是被 `extractChartsAfterFinish` 静默丢弃整个 `chart` 字段、只留一条 warn 级日志。后一个重复元素追加的 `#N` 后缀 id,对同一张图是稳定的(列表顺序在一次提取内是确定的),但不保证在一张顺序不同的重绘图里指向"同一个"物理 artist——这只影响本来就存在 id 碰撞的图表,而这些图表此前根本没有 `chart` 状态可供区分。`chart_matplotlib.py` 里 `_artist_for` 对 `kind: 'annotation'` 现有的子串查找(`"text:%s" % text.get_text()[:20] in element["id"]`)会把一个重复 id 及其 `#2` 后缀都解析到同一个最先匹配的 `axis.texts` artist;这个既有的歧义此前从未影响过任何可达图表(重复此前总是在上游被拒绝),本次改动不改变它——这不在本次范围内,若需要区分重复标注各自的命中表方框,需要单独修复。

## Verification

`packages/science/science-runtime/tests/real-acceptance.ts` 的 matplotlib `'tight'` 用例现在画一张分组柱状图,其柱值标注在去重前会碰撞(`control[0]=0.483` 与 `treatment[0]=0.477` 都格式化为 `"0.48"`),并断言得到的 artifact 携带一个 `runtime: 'matplotlib'` 的图表、所有元素 id 唯一、`annotation[text:0.48]` 与 `annotation[text:0.48]#2` 均存在——证明真实 kernel 的提取、`decodeScienceChartState`,以及整条 `extractChartsAfterFinish` host 路径端到端都能接受它。`packages/science/science-session/tests/chart-codec.spec.ts` 里已有的 `'rejects duplicate element ids, unordered hit bounds, and hits on an unavailable map'` 测试已经锁定了 codec 本身对两个同 id 元素的拒绝行为,无需改动。
