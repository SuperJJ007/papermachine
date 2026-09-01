# Agent Note: Science 产物身份属于产生它的会话

Status: proposed

[English](2026-08-30-science-artifact-identity-per-session.md) | 中文

## Problem

文件名不能建立跨对话的产物身份。2026-08-30，一个新对话的 grouped_bar_chart.png 从 v6 开始，因为另一会话在 8 月 29 日创建了同名图并人工编辑四次。另一张无关的 scatter_plot.png 同样从 v2 开始。它们的数据与标题无关，只因模型惯用的文件名相同就接续了版本链。

## Proposal

当前会话的 fold 首次遇到逻辑名时，自动捕获创建 v1 新产物。只有当前会话已有的 artifactId 才延续版本链。项目列表按 artifactId 区分行并允许同名，无需修改 schema。

跨对话关系必须通过精确版本的 artifact_inputs 显式声明，edit_of 仍限于本会话。旧日志保留已记录的版本号，包括首见即 v6 的事件；fold 接受这些历史记录，实时 capture 的 create 路径保证新产物为 v1。

本提案仅取代[项目产物库 S3](../../implemented/architecture/2026-08-26-project-artifact-store-s3.zh.md) 中按同名跨会话续链的决定。该记录中显式项目输入和存储访问的理由仍然有用，其历史正文保持不变。

直接修改表单按本地化子图标题分组，使用同一自适应标签列显示完整元素名；分组行之外的引用保留子图编号。Details 骨架提供独立的 keyed action 和 tab 槽位，对话栏与详情栏的标签页共用一份主题样式表。已有 Science selection store 在标签页和正文间共享已打开项目产物的元数据。

产物库按 originSessionId 分组是会话身份归属的直接结果：即使文件名碰撞，每组也由产生它的对话拥有。组头承载来源标题与最新产物时间，卡片不重复来源。当前会话置顶，卡片排序限于组内。折叠分组与文件库页通过既有选择存储引擎以会话作用域 localStorage 键持久化。相对时间格式函数统一放在 ui-primitives，供侧边栏与产物分组共用。

## Alternatives considered

**只在显示层换算版本号。** 将 v7 显示为“本对话第 2 版”后，模型可见的芯片与 get_science_state 仍然是 v7，人工编辑也仍把另一对话的图作为父版本。这只能遮住现象，不能修复身份。

**按文件名续链。** 模型生成的常用名称会在无关分析间重复，同名无法证明数据相同或存在编辑意图。显式 artifact_inputs 可以保留有意声明的关联，无需猜测。

## Acceptance criteria

不同会话捕获同名文件时创建不同 artifactId，均从 v1 开始，即使字节完全相同；首个产物的 latestVersionId 不变。本会话编辑继续原链，旧日志仍可回放。包测试和无密钥 Science snapshot 验证行为与 UUID 引导。

浏览器证据覆盖完整中英文标签、多子图分组、单子图无分组标题、composer 引用中的子图号、新产物版本号，以及两栏标题行和 tab 的相同基线。项目库查询确认同名产物为独立记录。

## Risks

项目中可以存在多个同名产物，标题、时间和 artifactId 用于区分，消费者不能假设逻辑名在项目内唯一。旧的误续链继续显示，因为会话日志不可变。跨会话直接编辑仍需要单独的血缘设计。
