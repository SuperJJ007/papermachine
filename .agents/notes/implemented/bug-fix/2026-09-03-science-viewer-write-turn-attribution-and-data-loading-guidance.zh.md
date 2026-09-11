# Agent Note: Viewer 写入的 turn 归属与数据加载提示词指引

Status: implemented

[English](2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.md) | 中文

## 问题

若异步工作后重新计算归属，空闲间隙的查看器保存可能漂移到未来 turn。数据加载指导也可能让用户以为内核已有表格，实际却只按文本读取。

## 决策

查看器写入在入口、任何重放或库 await 之前，只捕获一次最后启动的生产 turn。库摘要通过当前 Science 读取传递该坐标。轨迹先用投影坐标，再用库存生产 turn，最后才选择创建时间之前最近的已声明 turn start；没有符合 turn 时保持未分配。

Persona 指导表格分析使用 Python/R，确保内核实际持有数据。注释指导允许检查指定名称并报告不存在，而不是创建替代文件。每个事实只有一个 prompt owner。

## 考虑过的替代方案

**写入完成后再解析 turn。** 新启动的 turn 会移动同一产物。

**为查看器动作虚构开放工具调用 owner。** 用户动作没有授权模型调用。

**旧记录继续使用 latest-turn 回退。** 无坐标版本仍会漂移。

**在共享指导重复 persona 规则。** 增加固定 token，却没有新职责。

## 后果

入口时归属在后续 turn 中保持稳定。未知历史坐标仍保持未知。Prompt 指导改变工具选择，不增加 schema，也不把文件系统文本读取等同于加载 DataFrame。

## 相关决策

相关 owner：[science-read-remotes](../architecture/2026-09-09-science-read-remotes.zh.md); [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.zh.md).
