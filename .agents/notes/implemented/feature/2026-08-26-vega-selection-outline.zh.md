# Agent Note：Vega-Lite 选择外框

Status: implemented

[English](2026-08-26-vega-selection-outline.md) | 中文

## 问题

Raster 区域选择会在 artifact 上绘制矩形，而选择 Vega-Lite spec path 只会改变对应文本行的 pressed 状态。因此图表本身无法直观确认样式面板正在处理哪个渲染元素。

## 决定

Vega-Lite stage 在渲染后的 SVG 上拥有一个不可交互的外框。`vega-embed` 完成后，它使用 Vega 的 SVG role class：唯一的顶层 `.role-title`、`.role-mark`、由无障碍标签识别的 X/Y `.role-axis` 或唯一 `.role-legend` 会得到精确子树矩形。若选中 composition 内嵌 path、不支持的 channel、多个候选 role group 或任何其他有歧义的映射，则框住整张 SVG。overlay 与 raster `regionBox` 使用相同的边框和半透明填充。

矩形由 `getBoundingClientRect()` 相对于可滚动图表 frame 推导。选择变化、新 SVG 在 document 编辑后完成渲染，以及共享 `ResizeObserver` 报告 frame 或图表内容尺寸变化时，都会重新计算。渲染失败时，它会随隐藏图表一同移除。

## 已考虑的替代方案

**从生成后的 mark 名称推导每一个嵌套 Vega-Lite path** — 已否决，因为 layer、concat group 等名称是编译器输出，不是稳定的 path 映射 API，而且 transform 可能从一个来源 path 生成多个 scenegraph mark。

**只使用整图外框** — 已否决，因为 Vega role class 能为常见的顶层 title、mark、axis 与单一 legend 选择提供稳定、可访问的精确 target。

**给 SVG node 写入 selected class** — 已否决，因为这些 node 由 `vega-embed` 拥有并替换。React 拥有的 sibling overlay 有明确生命周期，也不修改 renderer 输出。

## 后果

精确外框覆盖顶层 `title`、唯一 `mark` group、`encoding.x`、`encoding.y`，以及仅在恰有一个 legend 时会生成 legend 的顶层 color/fill/stroke/size/shape/opacity channel。嵌套 composition path 与有歧义的 role 会有意使用整图兜底。本 Note 扩展但不取代 [Science workbench UI convergence](2026-08-23-science-workbench-ui-convergence.zh.md)，后者仍然拥有选择与 composer 语义。
