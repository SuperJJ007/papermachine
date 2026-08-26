# Agent Note：R Vega-Lite 与文件库信息架构

Status: implemented

[English](2026-08-27-r-vega-lite-and-library-ia.md) | 中文

## Problem

Science 图表行为依赖了生成与展示路径中的偶然差异。R 指引把所有图表都视为 raster 输出，尽管可编辑 viewer 消费的是与执行语言无关的 Vega-Lite media type。viewer 在解析前按普通文本显示上限截断 Vega-Lite 原文，因此包含较大内联数据集的有效 spec 会变成无效 JSON，并以原文形式出现。Details 列还在文档 tab 下方放置了额外的文件库开关，形成三级导航；没有打开文档时仍保留一条空 tab 行。

## Decision

### R-authored editable charts

R 代码应把 Vega-Lite 能表达的 spec 构造成嵌套 list 与 data.frame，再用 `jsonlite::write_json(spec, path, auto_unbox = TRUE, digits = NA)` 写入 `.vl.json`。runtime capture 已经只按扩展名赋予 `application/vnd.vega-lite+json`，不会检查执行语言，因此 R 与 Python artifact 共用结构化选择与直接样式编辑路径。Vega-Lite 无法表达的图表继续以 raster PNG 作为兜底。

不引入 ggplot2 到 Vega-Lite 的转换器。直接编写 JSON 使用现有 runtime 依赖，并避免新增一层转换机制；否则它所支持的 geometry 与 transformation 子集会成为额外的产品义务。

### Vega-Lite render and display limits

viewer 会完整解析不超过 `MAX_VEGA_LITE_SPEC_CHARACTERS`（8,000,000 字符）的 Vega-Lite spec。这是浏览器解析与渲染安全上限，独立于 `MAX_ARTIFACT_TEXT_CHARACTERS`（100,000 字符）；后者只限制 spec 超限、解析失败或 renderer 失败后显示的原文。普通 JSON 继续在解析前应用 100,000 字符显示上限。

图表生成指引还要求 Python 作者在把表格交给 Altair 前先聚合或抽样数据，并只保留图表实际使用的行与列。更高的 viewer 上限用于支持合理的大 spec，并不意味着应把不需要的原始表完整内联进去。

### Two-level file library

Details header 拥有一级导航：「产物」与「项目文件」。selection store 以 `libraryPage` 持久保存该选择。两个页面共用同一条二级文档栏，其中可同时打开 artifact 与 workspace file。文档活跃时选择一级页签会返回所选文件库页，但不关闭任何文档。文件库 body 不再有额外分区开关；文档记录为空时不渲染文档栏。

## Alternatives considered

**让 R 图表继续只走 raster。** 拒绝，因为 runtime 与 viewer 已经使用与语言无关的 media type，R 无需图表转换依赖就能发射所需 JSON。

**提高普通文本上限。** 拒绝，因为渲染需要完整 JSON，而失败后的原文需要有界 DOM。共用一个上限要么继续破坏有效 spec，要么允许过量原文渲染。

**为产物与项目文件分别设置文档栏。** 拒绝，因为文档来源不会改变其导航行为。共用文档栏可以保留去重、原位版本替换与关闭后选择邻居的规则。

## Consequences

R 生成的 Vega-Lite 图表获得与 Python spec 相同的元素选择与样式编辑，同时保留 raster 区域选择。100,000 至 8,000,000 字符的 spec 会从完整 JSON 渲染；失败状态会说明原因并显示有界原文。Details 列只保留两个可见导航层级，在查看文档及面板重开后仍记住文件库页，并且在打开首个文档前不为 tab 条分配高度。
