# Agent Note: 原生图形编辑

Status: implemented

[English](2026-08-28-science-live-figure-editing.md) | 中文

## 问题

研究者需要选择并调整现有图表，不应要求模型用另一种绘图语法重建，也不应在预览时修改分析内核。

## 决策

原生图形编辑保留 matplotlib 或 ggplot 状态及用户看到的精确 PNG。项目库存储图形状态、元素目录、hitmap、导出设置、来源和累计编辑操作。原生 pane 执行五种有界类型化操作：标题、轴标签、图例位置、网格显示及字体修改。不支持直接编辑的元素仍可被引用，不能宣称它们可直接编辑。

热重放编辑已保存基线的私有副本；冷重放使用隔离解释器及精确记录的源输入。预览不创建产物或 Science run 事件，显式保存才提交新的不可变版本。Hitmap 不匹配时禁用几何选择但保留元素目录。两种 adapter 都实现并验证操作后，才能扩大共享直接编辑 API。

## 考虑过的替代方案

**把图表转换为 Vega、Plotly 等语法。** 会增加第二套绘图语义来源并丢失原生库行为。

**直接编辑活跃分析对象。** 预览会修改后续分析，连续编辑也将依赖交互顺序而非不可变基线。

**把任意文本指令当作直接操作。** 不支持的操作可能静默退化成模型工作或 adapter 特有行为。

**修改全局 rcParams 或枚举全部字体。** 编辑会逸出当前图形，并引入依赖 Host 的字体发现行为。

## 后果

精确几何依赖原生 DPI 和记录的导出设置。Base R graphics 仍可生成 PNG，但不会因此获得 ggplot 编辑目录。目录涵盖标题、标签、刻度、图例、系列、网格、坐标轴、尺寸、字体和注解；被列入目录不表示五种直接操作支持它。多坐标轴标题、R 图例映射和坐标转换需要 adapter 特定处理。历史重放测量不是延迟保证。原生 V3 admission 和精简工具回执仍各有 owner。

## 相关决策

相关 owner：[chart-edit-baseline-isolation](../bug-fix/2026-08-31-chart-edit-baseline-isolation.zh.md); [science-cold-replay-isolation](../bug-fix/2026-08-31-science-cold-replay-isolation.zh.md); [chart-font-alias-and-title-row](../bug-fix/2026-09-03-chart-font-alias-and-title-row.zh.md); [science-required-session-events](2026-09-10-science-required-session-events.zh.md); [science-native-sidebar](2026-09-10-science-native-sidebar.zh.md).
