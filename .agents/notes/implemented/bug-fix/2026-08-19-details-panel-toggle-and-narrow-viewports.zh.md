# Agent Note: 详情列可以打开、关闭，并能容纳窄视口

Status: implemented

[English](2026-08-19-details-panel-toggle-and-narrow-viewports.md) | 中文

## Problem

同一个表面上的三个缺陷，全部来自实际使用随附 Web 应用，而不是来自测试。

**页头控件只能打开，永远关不上。** `ConversationHeaderActionOwnerProps.openDetailsView` 选中一个 entry 并调用 `layout.openDetails()`，而后者的 store action 在面板已打开时是空操作。会话页头按钮是一个常驻可用的控件：读者按一下去看某样东西，再按一下把它收起来；而我们的按钮只会打开，于是 artifact 面板只能通过面板自身的关闭控件才能收起。

**在窄视口上面板根本打不开，而且毫无提示。** `computeColumns` 运行的让步链中，侧边栏永不让步：`CENTER_MIN` 为 640 时，展开的 280px 侧边栏加上 `DETAILS_MIN`，需要 1220px 面板才能渲染出任何宽度。在侧边栏自动收起断点（1024）与 1220 之间，求解器每一帧都推导出零宽的 details 轨道，于是页头控件写入了打开偏好，却什么都没出现，也没有任何诊断说明原因。竖屏显示器正落在这个区间里。既有测试套件把该行为固化成了断言（"step 3: details auto-closes … sidebar holds its preference"），而不是捕获它。

**面板对于它如今承载的内容来说太窄了。** `DETAILS_MAX` 的 520 是在该列还只展示工具 input/output 时选定的。Artifact 内容——图表、表格、notebook 文本——所需的阅读宽度，是一个转录区侧边面板从未需要过的。

## Decision

**开合。** 页头 owner prop 改为 `toggleDetailsView(id)`，两个方向的判定放在两项事实都已就位的地方。`ConversationSessionHeader` 持有 `store: chatStore`，因此它自己读取 `detailsView`：若点击所指的 entry 正是 store 已经显示的那个，就调用新增的 `ctx.layout.toggleDetails()`；其余点击一律走既有的 `openDetailsView(id)` 并打开。layout store 的 `toggleDetails` action 在自己的 draft 上把 `details` 在 0 与 `DETAILS_DEFAULT` 之间翻转，而该 draft 正是开/关的权威事实——没有任何组件镜像面板状态，`LayoutController` 也仍是绑定 action 之上的纯转发者。

chat-node 路径保留只负责打开的 `openDetailsView`：点击转录行意味着"查看这个"，绝不能关掉读者正用来查看的那个面板。

**几何。** `CENTER_MIN` 从 640 降到 440，取值的依据是让两套机制彼此对齐，而不是在它们之间留下缝隙：`SIDEBAR_DEFAULT + DETAILS_MIN + CENTER_MIN` = 1020 ≤ `SIDEBAR_AUTO_COLLAPSE`（1024）。因此断点及以上的任何视口，都能在侧边栏展开的情况下容纳该面板；而断点以下侧边栏本就是 56px 轨道，把可容纳宽度进一步降到 796。那段盲区是被构造性地消除的，而不是把某个常数一点点调大到恰好让上报的那个案例可用。

`DETAILS_MAX` 提升到 960，`DETAILS_DEFAULT` 提升到 420。让步链仍会限定任一视口实际给出的宽度，因此一个宽松的拖拽上限在小屏幕上不付出任何代价。

## Alternatives considered

**在某个断点以下把详情面板改为覆盖式抽屉。** 这是窄屏问题的常规答案，也是最初起草的设计。本轮否决，是因为它为了修复一段用一个常数就能消除的区间，引入了第二套呈现模式——绝对定位、自成一套的拖拽把手计算、遮罩层，以及一条关闭规则。对真正的小窗口而言它仍是正确答案：低于 796px 面板依旧打不开，而覆盖式抽屉正是服务那个场景的做法。

**调整让步链顺序，让侧边栏先于详情面板让步。** 它直接表达了"读者要的是 artifact 面板，所以导航列表先退让"，也同样能消除盲区。否决的原因是：侧边栏自动收起断点已经在几乎整个受影响范围内把侧边栏收成轨道，使这次重排只在 36px 的窄缝里才起作用——却要引入一种 `toggleSidebar` 并不知情的派生收起状态，于是每当求解器自行收起侧边栏，侧边栏开关看起来就会像失灵一样。

**让页头 action 通过新增的 `ILayout` 读取接口去读面板开合状态。** 否决，因为 `LayoutController` 持有的是绑定 action 而非 store 实例，这个读取接口只能在 controller 内部镜像开/关状态——那是 store 已拥有事实的第二份副本，而且 `AppFrame` 自身在切换 Session 时调用的 `closeDetails()` 会悄悄使其失同步。

**页头 prop 仍叫 `openDetailsView`，只是让它具备开合行为。** 否决：这个名字会对它一半的职责说谎，而 chat-node 路径又确实保留只打开的语义，于是同一个名字对应两种行为只会造成实质性的误导。

## Consequences

现在同一个页头控件掌管着它所打开面板的两个方向，且在侧边栏断点及以上的任何视口——包括竖屏显示器——面板都是可达的。拖拽范围为 300 到 960。

`CENTER_MIN` 现在承担了它此前没有的结构性作用：它通过一条不等式被钉在 `SIDEBAR_AUTO_COLLAPSE` 上，不重新核对这一关系就调高它，会让盲区重新出现。该常数自身的文档注释与一条专门的测试都陈述了这一关系，因此未来的改动必须正面面对它。

所放弃的东西：低于 796px 时详情面板仍会自动关闭且不向读者作任何解释，与此前一致。那正是上文所述的覆盖式抽屉场景，此处是有意推迟而非已经解决。

## Testing

`packages/client/ui-layout/tests/columns.client.spec.ts` 把该断点关系本身写成对常数的断言，因此盲区无法经由一次常数修改重新出现，同时覆盖了放宽后的拖拽上限。`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 驱动页头 owner prop 走完三种情形——首次打开、重复点击关闭，以及切到另一个 entry 时只路由不关闭。`packages/client/ui-science/tests/ScienceHeaderAction.client.spec.tsx` 证明该 action 对每次点击的转发完全一致，且自身不持有任何面板状态。`ui-layout` 的 app-frame 测试则把新几何贯穿到渲染出的 grid 轨道与拖拽基准上。
