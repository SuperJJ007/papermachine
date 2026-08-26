# Agent Note: 修正 page-utilities 头部留白判断，改读 outlet 自身的子节点

Status: implemented

[English](2026-08-24-conversation-page-utilities-clearance.md) | 中文

## Problem

`ConversationRoot` 只在 `conversation.page.utilities` 真的往 Session 头部右上角渲染内容时，才为头部预留额外的右侧留白（`padding-right: 64px`，而非基础的 28px），这样空槽位不会白白占用空间。这个判断读取包裹层 `.pageUtilities` div 上的 `pageUtilitiesRef.current.childElementCount`。但每一个 outlet 的 `renderSlot`——包括零注册项的 list 槽位，或唯一注册项在当前 session 下渲染 `null` 的槽位——都会恒定输出一个 `[data-slot]` 锚点 div（`ui-renderer` 的 outlet 约定：`display: contents`，无论派发结果如何都会存在，这样它在 DOM 中的位置不会随注册变化而闪烁）。这个锚点本身就是 `.pageUtilities` 的子节点，因此 `childElementCount` 始终至少为 1，留白标志始终为 `true`——不管槽位里到底有没有内容，都会永久预留这段额外留白。

这个问题此前未被发现，是因为覆盖该头部的 `apps/web` e2e 用例（`navigation-panes.e2e.ts`）断言了写死的 `<=32px` 几何间距，一旦针对真实浏览器 DOM 执行就会直接失败；而针对这个留白逻辑本身的包级单元测试之所以能通过，是因为它的 `renderSlot` 桩直接返回注册项自身的输出，并未还原真实 outlet 恒定附加的锚点包裹层。

## Decision

把存在性判断下移一层：改读 `pageUtilitiesRef.current.firstElementChild.childElementCount`，即锚点自身的子节点数，而不是锚点本身是否存在。`.pageUtilities` 的第一个（也是唯一的）子节点始终是锚点；当且仅当每个注册项都没有渲染任何内容时，这个锚点的 `childElementCount` 才为零，这才真正对应头部留白想要区分的"有内容/无内容"状态。

针对 `conversation.page.utilities` 的单元测试 `renderSlot` 桩，现在会用真实 outlet 恒定采用的同一个 `[data-slot]` 锚点模式包裹桩内容，这样测试练习的是真实 DOM 结构，而不是一个无法复现这类缺陷的扁平化替身。

## Alternatives considered

**放宽 e2e 几何断言，接受这段恒定预留的留白。** 不采用：该断言本身准确表达了产品意图（只在被占用时才预留留白），放宽它只会掩盖一个真实且永久存在的布局回归，而不是修复它。

**改用 CSS 选择器查询真实内容（例如排除 `[data-slot]` 包裹层），而不是下探一层 DOM。** 不采用，属于为同样的结果写更多代码：锚点始终是固定位置的唯一一层包裹，直接索引 `firstElementChild` 更简单，也不需要为这个并未使用 chain 类槽位的场景特殊处理嵌套锚点。

## Verification

`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 中 `ConversationRoot page-utilities clearance` 测试在修复前失败（已确认)，修复后在还原了锚点包裹层的桩上通过。`apps/web/tests/navigation-panes.e2e.ts` 中 Session Header 导出几何断言（未改动，仍是 `<=32px`）在头部不再永久预留额外 36px 后，针对真实构建的前端通过。

## Consequences

只要当前 session 没有渲染任何页面级 Science（或未来其他）工具动作——这是绝大多数非 Science session、以及非空白 Science session 的常见情形——Session 头部的导出/工具类操作就会更靠近头部右边缘。Science session 处于空白态、确实渲染 Files 动作时，仍会和此前一样预留这段留白。
