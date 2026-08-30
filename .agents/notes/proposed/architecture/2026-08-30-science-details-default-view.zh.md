# Agent Note: 详情栏默认渲染已注册的 primary 视图

Status: proposed

[English](2026-08-30-science-details-default-view.md) | 中文

## Problem

会话的详情栏「不是产物库」这件事经由三处彼此独立的表面达成，各自由不同的判断点决定：空白会话（`AppFrame.tsx` 只要 `detailsSession`——而非 `current`——为 undefined 就渲染根作用域的 `details.files` 槽而非会话作用域的 `details` 槽，把「空白过渡态」和「真正没有会话的欢迎页」混为一谈）；Science 模式尚未绑定的会话（`science === null` 时 `ScienceDetailsView.tsx` 渲染「未绑定」提示而非产物 viewer）；以及从未显式打开过详情视图的会话（`DetailsPanel.tsx resolveActiveDetailsView` 直接落到内置 `tool` 配置项，没有任何机制让领域包声明默认项）。用户打开一个全新对话时先看到「文件」／「选择一个会话」的空状态，发一条消息后变成「此会话尚无 Science 活动」，在真正点击消息流里的工具行之前又是「点击消息流中的工具行查看详情」。这三个状态都没有显示产品当作统一 Artifact 表面对待的产物库。

## Proposal

统一这三处判断点：

1. **`AppFrame.tsx`**：只要有当前 Session（含空白）就渲染会话作用域的 `details` 槽，只有完全没有当前 Session 时才回退到根作用域的 `details.files` 槽——分支条件从 `detailsSession === undefined` 改为 `current === undefined`。既有的自动关闭 effect（以非空白的 `detailsSession` 为键）保持不变：空白过渡态依旧不会关闭已经打开的面板。
2. **ui-slots 的通用 `register()`** 为 `list` 种类条目新增 `primary?: true` 选项（`packages/client/ui-slots/src/index.ts`）：一个 list 条目可以声明自己是「消费方未显式选择时」的默认项。每个 slot 最多一个条目可以携带它；第二次出现 `primary: true` 注册会在加载时抛错并指名已有的那个条目，与 `register()` 里其它种类约束一贯的 fail-loud 姿态一致。`ui-conversation` 的 `DetailsPanel.tsx resolveActiveDetailsView` 依次解析：显式 `selectedId` 命中优先，其次已注册的 `primary` 条目，最后内置 `tool` 条目。
3. **`ui-science` 的 `conversation.details.view` 注册**（`id: 'science'`）加上 `primary: true`，让产物库成为详情栏的默认配置项。
4. **`ScienceDetailsView.tsx`** 把 `science === null` 分支（「未绑定」提示）换成一个客户端占位投影（`EMPTY_SCIENCE_PROJECTION`：空的 `artifacts`／`runs`／`kernels`，`null` 的 `environment`／`outcome`），喂给与已绑定会话相同的 `ArtifactViewer`。产物库本身经 `loadLibrary` RPC（`sessions.scienceLibrary`，项目级、按产生它的对话分组）加载，与本会话自身的 `science` 投影无关，因此未绑定会话看到的库与一个已绑定但零产物的会话完全一样——不再出现第二条提示。`science === undefined` 分支（本次部署压根没有组合 Science 会话投影）与此无关，未改动。

四处表面都解决之后，一个全新对话的详情栏从首次绘制起、经过后续每一个状态都显示产物库；三个退役的 locale 键（`details.unbound`、`details.preset`，以及 `ScienceEmptyDetails`／`nav.files` 的「文件」文案，现在是「产物」／`Artifacts`）不再描述任何屏幕上可达的东西。

学科包（`.agents/tmp/agent-work/2026-08-26-discipline-packs/FEASIBILITY-REVIEW.md`）是 `science` preset 上的内容层，不是新 preset，因此本次改动涉及的每一处既有 `agentPreset === 'science'` 判定（`ScienceDestinations`、`ScienceHeaderAction`、`ScienceHeroAction`、`AppFrame` 的 `data-science-session`、`createTraceVisibilitySource`）天然已经覆盖它们，不需要改动。

## Alternatives considered

**让 `ui-science` 在会话挂载时调用 `openDetailsView('science')`，而不是加一个 `primary` 注册选项。** 这也能让产物库成为默认项，但 `openDetailsView` 会顺带打开详情栏——一个从未碰过详情栏的会话会自己把面板弹开，这与产品自身对面板开关状态的掌控相悖。`primary` 条目只在面板已经打开时（或经由 `AppFrame` 既有的 Part A 分支打开时）改变渲染内容；它从不主动打开一个已关闭的面板。

**把最低的 `order` 值当作隐含默认项，而不是新增 `primary` 选项。** `order` 控制的是详情栏页头在多个已注册配置项之间的排列顺序（目前只有 `tool` 和 `science`）；把它同时用来表示「未选择时默认显示」会混淆两个独立的维度——未来第三个配置项可能需要特定的显示位置却不想当默认项，反之亦然。专门的布尔字段把两个问题分开，并让 `register()` 用它对 `single` 槽单一占用者、`list`／`keyed` 条目身份唯一性同样的方式强制「最多一个」。

## Acceptance criteria

只要存在当前 Session（不论是否空白），`AppFrame` 渲染 `details` 而非 `details.files`；只有完全没有当前 Session 时才渲染 `details.files`；既有的空白过渡不触发自动关闭的行为不变。`ui-slots` 的 `register()` 接受 `list` 种类条目上的 `primary: true`，同一个 slot 第二次出现时抛错并指名已有的 primary 条目。`DetailsPanel` 的 `resolveActiveDetailsView` 依次返回显式选择、`primary`、`tool`。`ui-science` 的 `conversation.details.view` 注册携带 `primary: true`。`ScienceDetailsView` 对 `science === null` 渲染产物库（而非「未绑定」提示），`loadLibrary` 被调用，库的分组方式与已绑定会话完全一致；`science === undefined` 保留它自己独立的提示。一条无密钥 web 快照（`science-artifact-types.e2e.ts`）回放一个全新空白会话，展示「产物 | 项目文件」页头、库里出现其它会话的分组，DOM 里不出现「文件」「选择一个会话」「尚无 Science 活动」「点击消息流中的工具行」。

## Risks

`primary` 是框架里每一个 `list` 种类 slot 都获得的通用能力，不局限于 `conversation.details.view`——未来任何组合了多个 list 种类 slot 的包都继承同样的「最多一个 primary、在注册时强制」契约，这正是有意为之的通用性（与 `register()` 已经对 `single` 占用和 `list`／`keyed` 条目身份强制唯一性同一个道理）。一个声明了 `primary: true` 的详情配置项如果之后被移除（fiber 释放、HMR），详情栏会悄悄退回内置 `tool` 兜底、不再有任何 primary；这与既有的「陈旧选择落到 `tool`」姿态一致，不需要额外处理。
